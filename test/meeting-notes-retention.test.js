// test/meeting-notes-retention.test.js — excerpt TTL sweeper + require-time interval.
// DB-less by default. Optional live Postgres case is skipped without DATABASE_URL.

require('./helpers/env');

const { test } = require('node:test');
const assert = require('node:assert');

const intervalCalls = [];
const origSetInterval = global.setInterval;
global.setInterval = function (...args) {
  intervalCalls.push(args[1]);
  return origSetInterval.apply(this, args);
};
let api;
try {
  api = require('../services/meeting_notes/api');
} finally {
  global.setInterval = origSetInterval;
}

const db = require('../db');
const sentry = require('../services/infra/sentry');

test('sweepExpiredExcerpts is exported', () => {
  assert.strictEqual(typeof api.sweepExpiredExcerpts, 'function');
  assert.strictEqual(typeof api.verifyOverdueExcerpts, 'function');
  assert.strictEqual(typeof api.getExcerptSweepMetrics, 'function');
});

test('requiring api.js starts no sweeper interval unless backgroundEnabled', () => {
  assert.strictEqual(require('../services/runtime_flags').backgroundEnabled(), false);
  assert.deepStrictEqual(intervalCalls, []);
});

test('sweepExpiredExcerpts is a no-op when hasDb() is false', async () => {
  const orig = db.hasDb;
  db.hasDb = () => false;
  try {
    const result = await api.sweepExpiredExcerpts();
    assert.ok(result && result.ok === true);
    assert.strictEqual(result.skipped, 'no_db');
    const overdue = await api.verifyOverdueExcerpts();
    assert.ok(overdue && overdue.ok === true);
    assert.strictEqual(overdue.skipped, 'no_db');
  } finally {
    db.hasDb = orig;
  }
});

const HAS_DB = typeof db.hasDb === 'function' && db.hasDb();
const skip = HAS_DB ? false : 'no DATABASE_URL — live excerpt TTL sweep skipped';

async function _seedExpiredNote(p, tenant, suffix, extras = {}) {
  const ct = extras.excerptCt || Buffer.from('excerpt-ct');
  const iv = extras.excerptIv || Buffer.from('iv-12bytes!!');
  const tag = extras.excerptTag || Buffer.from('tag-16-bytes!!!!');
  const sumCt = extras.summaryCt || Buffer.from('summary-ct-keep');
  const sumIv = extras.summaryIv || Buffer.from('sum-iv-12byt');
  const sumTag = extras.summaryTag || Buffer.from('sum-tag-16bytes!');
  const ins = await p.query(
    `INSERT INTO meeting_notes_runs
       (tenant_id, contact, summary, transcript_excerpt, transcript_sha256, source, generated_by,
        excerpt_ciphertext, excerpt_iv, excerpt_tag, excerpt_expires_at,
        summary_ciphertext, summary_iv, summary_tag)
     VALUES ($1,$2::jsonb,$3::jsonb,$4,$5,'ai',NULL,$6,$7,$8, now() - interval '1 day',$9,$10,$11)
     RETURNING id, created_at`,
    [
      tenant,
      JSON.stringify({ name: 'Ada' }),
      JSON.stringify({}),
      extras.plain == null ? 'plain-excerpt-should-go' : extras.plain,
      'sha-' + suffix,
      ct, iv, tag, sumCt, sumIv, sumTag,
    ]
  );
  return {
    id: ins.rows[0].id,
    created_at: ins.rows[0].created_at,
    ct, iv, tag, sumCt, sumIv, sumTag,
  };
}

function _parseLogLines(lines) {
  return lines.map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

test('live sweep NULLs expired excerpt columns and never deletes the row', { skip }, async (t) => {
  const { ensureMeetingNotesSchema } = require('../services/meeting_notes/schema');
  const { ensureTenantSchema } = require('../services/tenants/schema');
  await ensureTenantSchema();
  await ensureMeetingNotesSchema();

  const p = db.getPool();
  const suffix = `mn-ttl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenant = (await p.query(
    `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
    [`MN TTL ${suffix}`, `mn-ttl-${suffix}`]
  )).rows[0].id;
  t.after(async () => {
    await p.query(`DELETE FROM meeting_notes_runs WHERE tenant_id=$1`, [tenant]).catch(() => {});
    await p.query(`DELETE FROM tenants WHERE id=$1`, [tenant]).catch(() => {});
  });

  const seeded = await _seedExpiredNote(p, tenant, suffix);

  const result = await api.sweepExpiredExcerpts();
  assert.ok(result && result.ok === true);
  assert.ok(result.purged >= 1);
  assert.strictEqual(result.overdue, 0);
  assert.strictEqual(result.failures, 0);

  const row = (await p.query(
    `SELECT id, contact, source, created_at, transcript_sha256,
            transcript_excerpt, excerpt_ciphertext, excerpt_iv, excerpt_tag, transcript_purged_at,
            summary_ciphertext, summary_iv, summary_tag
       FROM meeting_notes_runs WHERE id=$1 AND tenant_id=$2`,
    [seeded.id, tenant]
  )).rows[0];
  assert.ok(row, 'sweeper must not DELETE the row');
  assert.strictEqual(row.id, seeded.id);
  assert.strictEqual(row.transcript_excerpt, null);
  assert.strictEqual(row.excerpt_ciphertext, null);
  assert.strictEqual(row.excerpt_iv, null);
  assert.strictEqual(row.excerpt_tag, null);
  assert.ok(row.transcript_purged_at, 'transcript_purged_at must be set');
  assert.deepStrictEqual(row.contact, { name: 'Ada' });
  assert.strictEqual(row.source, 'ai');
  assert.strictEqual(row.transcript_sha256, 'sha-' + suffix);
  assert.ok(Buffer.compare(row.summary_ciphertext, seeded.sumCt) === 0, 'encrypted summary ciphertext must remain');
  assert.ok(Buffer.compare(row.summary_iv, seeded.sumIv) === 0, 'summary IV must remain');
  assert.ok(Buffer.compare(row.summary_tag, seeded.sumTag) === 0, 'summary auth tag must remain');
  assert.strictEqual(new Date(row.created_at).getTime(), new Date(seeded.created_at).getTime());

  const metrics = api.getExcerptSweepMetrics();
  assert.ok(metrics.lastSuccessAt, 'lastSuccessAt set only after zero failures and zero overdue');
  assert.strictEqual(metrics.lastOverdue, 0);
  assert.strictEqual(metrics.lastFailures, 0);

  const overdue = await api.verifyOverdueExcerpts();
  assert.strictEqual(overdue.overdue, 0);

  const second = await api.sweepExpiredExcerpts();
  assert.ok(second.ok === true);
  assert.strictEqual(second.purged, 0);
  const again = (await p.query(
    `SELECT id, summary_ciphertext, summary_iv, summary_tag, transcript_excerpt
       FROM meeting_notes_runs WHERE id=$1 AND tenant_id=$2`,
    [seeded.id, tenant]
  )).rows[0];
  assert.ok(again, 'second sweep must still leave the history row');
  assert.strictEqual(again.transcript_excerpt, null);
  assert.ok(Buffer.compare(again.summary_ciphertext, seeded.sumCt) === 0);
  assert.ok(Buffer.compare(again.summary_iv, seeded.sumIv) === 0);
  assert.ok(Buffer.compare(again.summary_tag, seeded.sumTag) === 0);
});

test('verifyOverdueExcerpts reports leftovers when UPDATE is skipped', { skip }, async (t) => {
  const { ensureMeetingNotesSchema } = require('../services/meeting_notes/schema');
  const { ensureTenantSchema } = require('../services/tenants/schema');
  await ensureTenantSchema();
  await ensureMeetingNotesSchema();

  const p = db.getPool();
  const suffix = `mn-overdue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenant = (await p.query(
    `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
    [`MN overdue ${suffix}`, `mn-overdue-${suffix}`]
  )).rows[0].id;
  t.after(async () => {
    await p.query(`DELETE FROM meeting_notes_runs WHERE tenant_id=$1`, [tenant]).catch(() => {});
    await p.query(`DELETE FROM tenants WHERE id=$1`, [tenant]).catch(() => {});
  });

  await _seedExpiredNote(p, tenant, suffix);
  const before = await api.verifyOverdueExcerpts();
  assert.ok(before.overdue >= 1, 'seeded expired excerpt must be overdue before a successful sweep');

  const origGetPool = db.getPool;
  const origQuery = p.query.bind(p);
  db.getPool = () => ({
    query: async (sql, params) => {
      if (/^\s*UPDATE\s+meeting_notes_runs/i.test(sql)) {
        return { rows: [], rowCount: 0 };
      }
      return origQuery(sql, params);
    },
  });
  const priorSuccess = api.getExcerptSweepMetrics().lastSuccessAt;
  let sweepResult;
  try {
    sweepResult = await api.sweepExpiredExcerpts();
  } finally {
    db.getPool = origGetPool;
  }
  assert.ok(sweepResult && sweepResult.ok === false);
  assert.ok(sweepResult.overdue >= 1);
  assert.strictEqual(api.getExcerptSweepMetrics().lastSuccessAt, priorSuccess, 'failed retention must not stamp lastSuccessAt');

  const after = await api.verifyOverdueExcerpts();
  assert.ok(after.overdue >= 1);
});

test('purge failures are surfaced rather than swallowed', { skip }, async (t) => {
  const { ensureMeetingNotesSchema } = require('../services/meeting_notes/schema');
  const { ensureTenantSchema } = require('../services/tenants/schema');
  await ensureTenantSchema();
  await ensureMeetingNotesSchema();

  const p = db.getPool();
  const suffix = `mn-fail-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenant = (await p.query(
    `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
    [`MN fail ${suffix}`, `mn-fail-${suffix}`]
  )).rows[0].id;
  t.after(async () => {
    await p.query(`DELETE FROM meeting_notes_runs WHERE tenant_id=$1`, [tenant]).catch(() => {});
    await p.query(`DELETE FROM tenants WHERE id=$1`, [tenant]).catch(() => {});
  });

  const seeded = await _seedExpiredNote(p, tenant, suffix);
  const secret = 'detail: Key (transcript_excerpt)=(Jane: we have budget approved)';
  const origGetPool = db.getPool;
  const origQuery = p.query.bind(p);
  db.getPool = () => ({
    query: async (sql, params) => {
      if (/^\s*UPDATE\s+meeting_notes_runs/i.test(sql)) {
        throw new Error(secret);
      }
      return origQuery(sql, params);
    },
  });

  const captured = [];
  const origCap = sentry.captureException;
  sentry.captureException = (err, ctx) => { captured.push({ err, ctx }); };
  const errors = [];
  const origErr = console.error;
  console.error = (...args) => errors.push(args.map(String).join(' '));
  let result;
  try {
    result = await api.sweepExpiredExcerpts();
  } finally {
    db.getPool = origGetPool;
    sentry.captureException = origCap;
    console.error = origErr;
  }

  assert.ok(result, 'failed sweep must settle');
  assert.strictEqual(result.ok, false);
  assert.ok(result.failures > 0);
  const row = (await p.query(
    `SELECT transcript_excerpt, excerpt_ciphertext FROM meeting_notes_runs WHERE id=$1 AND tenant_id=$2`,
    [seeded.id, tenant]
  )).rows[0];
  assert.ok(row.transcript_excerpt, 'failed UPDATE must leave plaintext excerpt');
  assert.ok(row.excerpt_ciphertext, 'failed UPDATE must leave excerpt ciphertext');

  const joined = errors.join('\n');
  const parsed = _parseLogLines(errors);
  assert.ok(
    parsed.some((l) => l.msg === 'meeting_notes_excerpt_sweep_failed') ||
    parsed.some((l) => l.msg === 'meeting_notes_excerpt_retention_overdue'),
    'failed sweep must emit a structured operational error'
  );
  assert.ok(!joined.includes(secret), 'pg error text must not reach process logs');
  assert.ok(!joined.includes('plain-excerpt-should-go'));
  assert.ok(!joined.includes('Jane: we have budget'));
  assert.ok(captured.length >= 1);
  for (const c of captured) {
    assert.ok(!String(c.err && c.err.message).includes(secret));
  }

  const overdue = await api.verifyOverdueExcerpts();
  assert.ok(overdue.overdue >= 1);
});

test('sweep leaves complete NULL-TTL triples; backfill past TTL then sweep purges excerpt only', { skip }, async (t) => {
  const {
    ensureMeetingNotesSchema,
    NONCOMPLIANT_SQL,
  } = require('../services/meeting_notes/schema');
  const { ensureTenantSchema } = require('../services/tenants/schema');
  await ensureTenantSchema();
  await ensureMeetingNotesSchema();

  const p = db.getPool();
  const suffix = `mn-nullttl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenant = (await p.query(
    `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
    [`MN nullttl ${suffix}`, `mn-nullttl-${suffix}`]
  )).rows[0].id;
  t.after(async () => {
    await p.query(`DELETE FROM meeting_notes_runs WHERE tenant_id=$1`, [tenant]).catch(() => {});
    await p.query(`DELETE FROM tenants WHERE id=$1`, [tenant]).catch(() => {});
  });

  const ct = Buffer.from('null-ttl-excerpt-ct');
  const iv = Buffer.from('iv-12bytes!!');
  const tag = Buffer.from('tag-16-bytes!!!!');
  const sumCt = Buffer.from('null-ttl-summary-ct');
  const sumIv = Buffer.from('sum-iv-12byt');
  const sumTag = Buffer.from('sum-tag-16bytes!');
  const seeded = (await p.query(
    `INSERT INTO meeting_notes_runs
       (tenant_id, contact, summary, transcript_excerpt, transcript_sha256, source, generated_by, created_at,
        excerpt_ciphertext, excerpt_iv, excerpt_tag, excerpt_expires_at,
        summary_ciphertext, summary_iv, summary_tag)
     VALUES ($1,$2::jsonb,$3::jsonb,$4,$5,'ai',NULL, now() - interval '31 days',
             $6,$7,$8,NULL,$9,$10,$11)
     RETURNING id, created_at`,
    [
      tenant,
      JSON.stringify({ name: 'Ada' }),
      JSON.stringify({}),
      'leftover-plain-must-wait-for-backfill',
      'sha-' + suffix,
      ct, iv, tag, sumCt, sumIv, sumTag,
    ]
  )).rows[0];

  const loadRow = async () => (await p.query(
    `SELECT id, tenant_id, transcript_excerpt, excerpt_ciphertext, excerpt_iv, excerpt_tag,
            excerpt_expires_at, transcript_purged_at,
            summary_ciphertext, summary_iv, summary_tag, contact, source, transcript_sha256, created_at,
            created_at + interval '30 days' AS expected_expires,
            (excerpt_expires_at = created_at + interval '30 days') AS ttl_matches
       FROM meeting_notes_runs WHERE id=$1 AND tenant_id=$2`,
    [seeded.id, tenant]
  )).rows[0];

  await api.sweepExpiredExcerpts();

  const untouched = await loadRow();
  assert.ok(untouched, 'sweeper must not DELETE a NULL-TTL complete triple');
  assert.strictEqual(untouched.tenant_id, tenant);
  assert.ok(Buffer.compare(untouched.summary_ciphertext, sumCt) === 0);
  assert.ok(Buffer.compare(untouched.summary_iv, sumIv) === 0);
  assert.ok(Buffer.compare(untouched.summary_tag, sumTag) === 0);
  if (untouched.excerpt_expires_at == null) {
    assert.strictEqual(untouched.transcript_excerpt, 'leftover-plain-must-wait-for-backfill');
    assert.ok(Buffer.compare(untouched.excerpt_ciphertext, ct) === 0, 'NULL-TTL ciphertext must remain until backfill');
    assert.ok(Buffer.compare(untouched.excerpt_iv, iv) === 0, 'NULL-TTL IV must remain until backfill');
    assert.ok(Buffer.compare(untouched.excerpt_tag, tag) === 0, 'NULL-TTL tag must remain until backfill');
    assert.strictEqual(untouched.transcript_purged_at, null);
    const overdueBeforeBackfill = (await p.query(
      `SELECT COUNT(*)::int AS n FROM meeting_notes_runs
        WHERE tenant_id=$1
          AND excerpt_expires_at IS NOT NULL
          AND excerpt_expires_at < now()
          AND (
            transcript_excerpt IS NOT NULL
            OR excerpt_ciphertext IS NOT NULL
            OR excerpt_iv IS NOT NULL
            OR excerpt_tag IS NOT NULL
          )`,
      [tenant]
    )).rows[0].n;
    assert.strictEqual(overdueBeforeBackfill, 0, 'NULL TTL must not match the overdue sweeper predicate');
  } else {
    assert.ok(
      untouched.excerpt_ciphertext == null || Buffer.compare(untouched.excerpt_ciphertext, ct) === 0,
      'concurrent heal may assign TTL but must not rewrite ciphertext'
    );
  }

  await p.query(
    `UPDATE meeting_notes_runs
        SET transcript_excerpt = NULL,
            excerpt_expires_at = COALESCE(excerpt_expires_at, created_at + interval '30 days')
      WHERE id=$1 AND tenant_id=$2`,
    [seeded.id, tenant]
  );
  const afterHeal = await loadRow();

  assert.ok(afterHeal, 'backfill must not DELETE the history row');
  assert.strictEqual(afterHeal.tenant_id, tenant);
  assert.ok(afterHeal.ttl_matches === true || (
    afterHeal.excerpt_expires_at && afterHeal.expected_expires &&
    new Date(afterHeal.excerpt_expires_at).getTime() === new Date(afterHeal.expected_expires).getTime()
  ), 'TTL must be created_at + 30 days');
  assert.ok(afterHeal.excerpt_expires_at && new Date(afterHeal.excerpt_expires_at) < new Date(), 'assigned TTL must already be in the past');
  assert.strictEqual(afterHeal.transcript_excerpt, null, 'leftover excerpt plaintext must be NULLed on heal');
  assert.ok(Buffer.compare(afterHeal.summary_ciphertext, sumCt) === 0, 'encrypted summary ciphertext must remain');
  assert.ok(Buffer.compare(afterHeal.summary_iv, sumIv) === 0, 'summary IV must remain');
  assert.ok(Buffer.compare(afterHeal.summary_tag, sumTag) === 0, 'summary auth tag must remain');
  if (afterHeal.excerpt_ciphertext != null) {
    assert.ok(Buffer.compare(afterHeal.excerpt_ciphertext, ct) === 0, 'backfill must not rewrite ciphertext');
    assert.ok(Buffer.compare(afterHeal.excerpt_iv, iv) === 0);
    assert.ok(Buffer.compare(afterHeal.excerpt_tag, tag) === 0);
    assert.strictEqual(afterHeal.transcript_purged_at, null, 'backfill must not stamp transcript_purged_at');
  } else {
    assert.strictEqual(afterHeal.excerpt_iv, null);
    assert.strictEqual(afterHeal.excerpt_tag, null);
    assert.ok(afterHeal.transcript_purged_at, 'a concurrent sweeper may purge only after TTL exists');
  }

  const leftoverIds = (await p.query(
    `SELECT id FROM meeting_notes_runs WHERE tenant_id=$1 AND (${NONCOMPLIANT_SQL})`,
    [tenant]
  )).rows.map((r) => r.id);
  assert.ok(!leftoverIds.includes(seeded.id), 'this tenant row must leave NONCOMPLIANT_SQL after TTL assignment');

  await api.sweepExpiredExcerpts();

  const row = await loadRow();
  assert.ok(row, 'sweeper must not DELETE the history row after TTL backfill');
  assert.strictEqual(row.tenant_id, tenant);
  assert.strictEqual(row.transcript_excerpt, null);
  assert.strictEqual(row.excerpt_ciphertext, null);
  assert.strictEqual(row.excerpt_iv, null);
  assert.strictEqual(row.excerpt_tag, null);
  assert.ok(row.transcript_purged_at, 'transcript_purged_at must be set after sweep');
  assert.ok(Buffer.compare(row.summary_ciphertext, sumCt) === 0, 'encrypted summary ciphertext must remain');
  assert.ok(Buffer.compare(row.summary_iv, sumIv) === 0, 'summary IV must remain');
  assert.ok(Buffer.compare(row.summary_tag, sumTag) === 0, 'summary auth tag must remain');
  assert.deepStrictEqual(row.contact, { name: 'Ada' });
  assert.strictEqual(row.source, 'ai');
  assert.strictEqual(row.transcript_sha256, 'sha-' + suffix);
  assert.strictEqual(new Date(row.created_at).getTime(), new Date(seeded.created_at).getTime());
});

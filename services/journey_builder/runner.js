// Journey runner — every 60s wakes pending runs and executes their next node.
// Supported node types: trigger, wait, condition, action(email|whatsapp|voice|sms|webpush|tag).
const _db = require('../../db');
const hasDb = () => _db.hasDb();
const pool = { query: (...a) => _db.getPool().query(...a) };

let _started = false;

async function executeNode(run, journey, node) {
  const log = run.log || [];
  const ts = new Date().toISOString();
  // Find outgoing edges for this node
  const outgoing = (journey.edges || []).filter(e => e.from === node.id);

  if (node.type === 'trigger') {
    log.push({ ts, node: node.id, action: 'trigger-fired' });
    return { nextNodeId: outgoing[0]?.to || null, waitMs: 0, log };
  }

  if (node.type === 'wait') {
    const minutes = Number(node.config?.minutes || 60);
    log.push({ ts, node: node.id, action: 'wait', minutes });
    return { nextNodeId: outgoing[0]?.to || null, waitMs: minutes * 60_000, log };
  }

  if (node.type === 'condition') {
    // simple equality check on contact_meta
    const key = node.config?.key || '';
    const expected = node.config?.equals;
    const actual = run.contact_meta?.[key];
    const matched = String(actual) === String(expected);
    const branch = matched ? 'yes' : 'no';
    const next = outgoing.find(e => (e.label || 'yes') === branch) || outgoing[0];
    log.push({ ts, node: node.id, action: 'condition', key, expected, actual, branch });
    return { nextNodeId: next?.to || null, waitMs: 0, log };
  }

  if (node.type === 'action') {
    const channel = node.config?.channel || 'email';
    const message = node.config?.message || '';
    const subject = node.config?.subject || '';
    let result = 'ok';
    try {
      // Fan out to existing services. Each is best-effort — if creds not set, we log + continue.
      if (channel === 'email' && run.contact_email) {
        try {
          const { Resend } = require('resend');
          if (process.env.RESEND_API_KEY) {
            const resend = new Resend(process.env.RESEND_API_KEY);
            await resend.emails.send({
              from: process.env.RESEND_FROM_EMAIL || 'noreply@infogenie.app',
              to: run.contact_email,
              subject: subject || 'Update from us',
              text: message
            });
          } else { result = 'skipped:no-resend-key'; }
        } catch (e) { result = 'email-failed:' + e.message; }
      } else if (channel === 'whatsapp' && run.contact_phone) {
        try {
          const wa = require('../whatsapp_channel/api');
          if (wa && typeof wa.sendText === 'function') await wa.sendText(run.contact_phone, message);
          else result = 'skipped:no-whatsapp';
        } catch (e) { result = 'wa-failed:' + e.message; }
      } else if (channel === 'voice' && run.contact_phone) {
        try {
          const v = require('../voice_caller/api');
          if (v && typeof v.placeCall === 'function') await v.placeCall(run.contact_phone, message);
          else result = 'skipped:no-voice';
        } catch (e) { result = 'voice-failed:' + e.message; }
      } else if (channel === 'sms' && run.contact_phone) {
        try {
          const sms = require('../omnichannel/sms');
          await sms.sendSms(run.contact_phone, message);
        } catch (e) { result = 'sms-failed:' + e.message; }
      } else if (channel === 'webpush') {
        try {
          const wp = require('../omnichannel/webpush');
          await wp.broadcast(subject || 'Notification', message, run.contact_meta?.subscription);
        } catch (e) { result = 'webpush-failed:' + e.message; }
      } else if (channel === 'tag') {
        result = 'tag:' + (node.config?.tag || 'untagged');
      } else {
        result = 'skipped:no-target';
      }
    } catch (e) { result = 'error:' + e.message; }
    log.push({ ts, node: node.id, action: 'send', channel, result });
    return { nextNodeId: outgoing[0]?.to || null, waitMs: 0, log };
  }

  log.push({ ts, node: node.id, action: 'unknown-node-type' });
  return { nextNodeId: outgoing[0]?.to || null, waitMs: 0, log };
}

let _ticking = false;
async function tick() {
  if (!hasDb()) return;
  if (_ticking) return; // prevent overlapping ticks in this process
  _ticking = true;
  try {
    // Atomically claim due runs: push next_run_at 5 min into the future so
    // a parallel tick (this process or another instance) can't pick the same row.
    const r = await pool.query(
      `WITH claimed AS (
         SELECT id FROM journey_runs
         WHERE status='running' AND (next_run_at IS NULL OR next_run_at <= now())
         ORDER BY next_run_at NULLS FIRST
         FOR UPDATE SKIP LOCKED
         LIMIT 50
       )
       UPDATE journey_runs jr
         SET next_run_at = now() + interval '5 minutes'
       FROM claimed
       WHERE jr.id = claimed.id
       RETURNING jr.*`
    );
    for (const run of r.rows) {
      try {
        const jr = await pool.query(`SELECT id,nodes,edges FROM journeys WHERE id=$1`, [run.journey_id]);
        if (!jr.rows.length) {
          await pool.query(`UPDATE journey_runs SET status='failed', completed_at=now() WHERE id=$1`, [run.id]);
          continue;
        }
        const journey = jr.rows[0];
        const node = (journey.nodes || []).find(n => n.id === run.current_node);
        if (!node) {
          await pool.query(`UPDATE journey_runs SET status='completed', completed_at=now() WHERE id=$1`, [run.id]);
          await pool.query(`UPDATE journeys SET stats = jsonb_set(stats,'{completed}', ((COALESCE(stats->>'completed','0')::int)+1)::text::jsonb) WHERE id=$1`, [run.journey_id]);
          continue;
        }
        const out = await executeNode(run, journey, node);
        if (!out.nextNodeId) {
          await pool.query(`UPDATE journey_runs SET status='completed', completed_at=now(), log=$1::jsonb WHERE id=$2`, [JSON.stringify(out.log), run.id]);
          await pool.query(`UPDATE journeys SET stats = jsonb_set(stats,'{completed}', ((COALESCE(stats->>'completed','0')::int)+1)::text::jsonb) WHERE id=$1`, [run.journey_id]);
        } else {
          const nextAt = new Date(Date.now() + out.waitMs);
          await pool.query(
            `UPDATE journey_runs SET current_node=$1, next_run_at=$2, log=$3::jsonb WHERE id=$4`,
            [out.nextNodeId, nextAt, JSON.stringify(out.log), run.id]
          );
        }
      } catch (e) {
        await pool.query(`UPDATE journey_runs SET status='failed', completed_at=now() WHERE id=$1`, [run.id]);
        await pool.query(`UPDATE journeys SET stats = jsonb_set(stats,'{failed}', ((COALESCE(stats->>'failed','0')::int)+1)::text::jsonb) WHERE id=$1`, [run.journey_id]);
        console.warn('[journey-runner] run', run.id, 'failed:', e.message);
      }
    }
  } catch (e) {
    console.warn('[journey-runner] tick error:', e.message);
  } finally {
    _ticking = false;
  }
}

function startRunner() {
  if (_started) return;
  _started = true;
  setInterval(tick, 60_000);
  setTimeout(tick, 5_000);
  console.log('[journey-runner] started — tick every 60s');
}

module.exports = { startRunner, tick };

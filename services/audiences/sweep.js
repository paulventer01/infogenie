// Dynamic Audiences — sweep engine (Phase 2).
// Pulls all HubSpot contacts (paginated), evaluates each enabled segment,
// diffs against current membership (audience_segment_members), and writes
// the join/leave events. Mutex-guarded single-writer; safe to call from
// the 15-min cron, the manual /refresh endpoint, or the HubSpot webhook.
//
// Multi-tenancy (Phase 2B): every membership row, evaluation log entry, and
// bridge call carries the segment's tenant_id. runSweepOnce can be scoped to
// one tenant via opts.tenantId, one segment via opts.segmentId, or run
// across all enabled segments globally (cron path).
const _db = require('../../db');
const { evaluateContact } = require('./engine');
const _bridge   = require('./drip_bridge');
const _hsList   = require('./hubspot_list_bridge');
const _reengage = require('./reengage_bridge');

const HUBSPOT_PROPS = [
  'email','firstname','lastname','lifecyclestage','country','jobtitle',
  'num_unique_pages_viewed','total_revenue','recent_conversion_date',
  'hs_email_open_count','hs_email_click_count','createdate','lastmodifieddate'
];

function _hubspotToContact(h) {
  const p = h.properties || {};
  return {
    id:    String(h.id),
    email: p.email || '',
    props: p,
    events: [],
    commerce: {
      total_purchases:    Number(p.total_revenue ? 1 : 0),
      last_purchase_at:   p.recent_conversion_date || null,
      aov:                Number(p.total_revenue || 0),
    },
    engagement: {
      opened_at:    Number(p.hs_email_open_count  || 0) > 0 ? new Date().toISOString() : null,
      clicked_at:   Number(p.hs_email_click_count || 0) > 0 ? new Date().toISOString() : null,
      pages_visited: [],
    },
    ai_referrers: {},
  };
}

async function _fetchHubspotPage(url, token, attempt = 0) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 429 && attempt < 3) {
    const wait = Math.min(30, Math.max(1, parseInt(r.headers.get('Retry-After') || '2', 10))) * 1000;
    await new Promise(res => setTimeout(res, wait));
    return _fetchHubspotPage(url, token, attempt + 1);
  }
  if (r.status >= 500 && attempt < 3) {
    await new Promise(res => setTimeout(res, (attempt + 1) * 1500));
    return _fetchHubspotPage(url, token, attempt + 1);
  }
  return r;
}
async function _fetchAllHubspotContacts(maxPages = 50) {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) return { ok:false, contacts:[], note:'HubSpot not connected' };
  const all = [];
  let after = null;
  for (let page = 0; page < maxPages; page++) {
    const url = `https://api.hubapi.com/crm/v3/objects/contacts?limit=100&properties=${HUBSPOT_PROPS.join(',')}` + (after ? `&after=${encodeURIComponent(after)}` : '');
    const r = await _fetchHubspotPage(url, token);
    const j = await r.json().catch(()=>({}));
    if (!r.ok) {
      return { ok:false, contacts:all, error: j.message || `hubspot ${r.status}`, partial: all.length > 0 };
    }
    (j.results || []).forEach(h => all.push(_hubspotToContact(h)));
    after = j.paging?.next?.after;
    if (!after) break;
  }
  return { ok:true, contacts:all };
}

// Evaluate one segment against a contact array, diff against current
// membership, and apply join/leave writes. Returns counts.
// All membership rows and the snapshot count are scoped/stamped with the
// segment's tenant_id.
async function _applySegmentDiff(client, segment, contacts) {
  const tid = segment.tenant_id; // may be null on legacy rows; column is nullable in Phase 2B
  const matchedNow = new Set();
  let evalErrors = 0;
  for (const c of contacts) {
    try { if (evaluateContact(segment.rules, c)) matchedNow.add(c.id); }
    catch (e) {
      evalErrors++;
      if (evalErrors <= 3) console.warn(`[audiences] eval err seg=${segment.id} contact=${c.id}: ${e.message}`);
    }
  }
  if (evalErrors > 0) console.warn(`[audiences] segment ${segment.id} had ${evalErrors} eval errors (rule may be malformed)`);

  const cur = await client.query(
    `SELECT contact_id FROM audience_segment_members WHERE segment_id=$1 AND left_at IS NULL`,
    [segment.id]
  );
  const currentlyIn = new Set(cur.rows.map(r => r.contact_id));

  const joins = [...matchedNow].filter(id => !currentlyIn.has(id));
  const leaves = [...currentlyIn].filter(id => !matchedNow.has(id));

  const joinTargets = [];
  for (const cid of joins) {
    const contact = contacts.find(c => c.id === cid);
    await client.query(`
      INSERT INTO audience_segment_members (tenant_id, segment_id, contact_id, contact_email, joined_at, left_at)
      VALUES ($1,$2,$3,$4, now(), NULL)
      ON CONFLICT (segment_id, contact_id) DO UPDATE
        SET tenant_id = COALESCE(EXCLUDED.tenant_id, audience_segment_members.tenant_id),
            joined_at = now(), left_at = NULL, contact_email = EXCLUDED.contact_email
    `, [tid, segment.id, cid, contact?.email || null]);
    joinTargets.push({ id: cid, email: contact?.email || null });
  }
  let leaveTargets = [];
  if (leaves.length) {
    const before = await client.query(
      `SELECT contact_id, contact_email FROM audience_segment_members
       WHERE segment_id=$1 AND contact_id = ANY($2::text[]) AND left_at IS NULL`,
      [segment.id, leaves]
    );
    leaveTargets = before.rows.map(r => ({ id: r.contact_id, email: r.contact_email }));
    await client.query(
      `UPDATE audience_segment_members SET left_at = now()
       WHERE segment_id = $1 AND contact_id = ANY($2::text[]) AND left_at IS NULL`,
      [segment.id, leaves]
    );
  }
  // Snapshot count — hard-scoped by tenant (when known) so cross-tenant
  // segment-id collisions can never overwrite the wrong row.
  if (tid != null) {
    await client.query(
      `UPDATE audience_segments SET member_count=$1, last_evaluated_at=now(), updated_at=now()
       WHERE id=$2 AND tenant_id=$3`,
      [matchedNow.size, segment.id, tid]
    );
  } else {
    await client.query(
      `UPDATE audience_segments SET member_count=$1, last_evaluated_at=now(), updated_at=now() WHERE id=$2`,
      [matchedNow.size, segment.id]
    );
  }

  return {
    matched: matchedNow.size,
    added: joins.length,
    removed: leaves.length,
    joinTargets,
    leaveTargets,
  };
}

let _sweepTail = Promise.resolve();
function _withLock(fn) {
  const next = _sweepTail.then(() => fn(), () => fn());
  _sweepTail = next.catch(() => {});
  return next;
}

// opts:
//   segmentId — restrict to a single segment id
//   tenantId  — restrict to one tenant's enabled segments (api /refresh path)
//   maxPages  — HubSpot pagination cap
async function runSweepOnce(opts = {}) {
  if (!_db.hasDb()) return { ok:false, error:'db not configured' };
  return _withLock(async () => {
    const t0 = Date.now();
    const pool = _db.getPool();
    let segs;
    if (opts.segmentId) {
      // Single-segment refresh — if a tenantId is supplied, hard-scope so a
      // caller from tenant A cannot refresh tenant B's segment by guessing id.
      if (opts.tenantId != null) {
        segs = await pool.query(
          `SELECT * FROM audience_segments WHERE id=$1 AND tenant_id=$2`,
          [Number(opts.segmentId), opts.tenantId]
        );
      } else {
        segs = await pool.query(
          `SELECT * FROM audience_segments WHERE id=$1`, [Number(opts.segmentId)]
        );
      }
    } else if (opts.tenantId != null) {
      segs = await pool.query(
        `SELECT * FROM audience_segments WHERE enabled = true AND tenant_id=$1`,
        [opts.tenantId]
      );
    } else {
      // Cron path — sweep every enabled segment across all tenants.
      segs = await pool.query(`SELECT * FROM audience_segments WHERE enabled = true`);
    }
    if (!segs.rows.length) return { ok:true, segments:0, note:'no segments to evaluate' };

    const fetchRes = await _fetchAllHubspotContacts(opts.maxPages || 50);
    const source = fetchRes.ok ? 'hubspot' : (fetchRes.contacts.length ? 'hubspot_partial' : 'unavailable');

    const results = [];
    for (const seg of segs.rows) {
      const segT0 = Date.now();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const r = await _applySegmentDiff(client, seg, fetchRes.contacts);
        await client.query(
          `INSERT INTO audience_evaluation_log (tenant_id, segment_id, contacts_scanned, members_added, members_removed, duration_ms, source)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [seg.tenant_id, seg.id, fetchRes.contacts.length, r.added, r.removed, Date.now()-segT0, source]
        );
        await client.query('COMMIT');

        const counters = { drip:{j:0,l:0}, hslist:{j:0,l:0}, reng:{j:0,l:0} };
        async function _fanOut(action, targets, counter) {
          for (const t of targets) {
            const calls = [
              _bridge[action](seg.id, t.id, t.email, seg.tenant_id).catch(e => ({ _err:'drip:'+e.message })),
              _hsList[action](seg.id, t.id, t.email, seg.tenant_id).catch(e => ({ _err:'hslist:'+e.message })),
              _reengage[action](seg.id, t.id, t.email, seg.tenant_id).catch(e => ({ _err:'reng:'+e.message })),
            ];
            const [d,h,n] = await Promise.all(calls);
            if (d?._err) console.warn(`[audiences→${d._err.split(':')[0]}] ${action} seg=${seg.id} ${t.id}: ${d._err}`);
            if (h?._err) console.warn(`[audiences→${h._err.split(':')[0]}] ${action} seg=${seg.id} ${t.id}: ${h._err}`);
            if (n?._err) console.warn(`[audiences→${n._err.split(':')[0]}] ${action} seg=${seg.id} ${t.id}: ${n._err}`);
            if (action === 'onJoin') {
              if (d?.enrolled) counter.drip.j++;
              if (h?.added)    counter.hslist.j++;
              if (n?.enrolled) counter.reng.j++;
            } else {
              if (d?.unsubscribed) counter.drip.l   += d.unsubscribed;
              if (h?.removed)      counter.hslist.l += 1;
              if (n?.unsubscribed) counter.reng.l   += n.unsubscribed;
            }
          }
        }
        await _fanOut('onJoin',  r.joinTargets  || [], counters);
        await _fanOut('onLeave', r.leaveTargets || [], counters);

        const { joinTargets, leaveTargets, ...slim } = r;
        results.push({
          segmentId: seg.id, name: seg.name, ...slim,
          bridgeJoins:  counters.drip.j,  bridgeLeaves:  counters.drip.l,
          hsListAdded:  counters.hslist.j, hsListRemoved: counters.hslist.l,
          reengageFired: counters.reng.j,  reengageExited: counters.reng.l,
        });
      } catch (e) {
        await client.query('ROLLBACK').catch(()=>{});
        await pool.query(
          `INSERT INTO audience_evaluation_log (tenant_id, segment_id, contacts_scanned, source, error) VALUES ($1,$2,$3,$4,$5)`,
          [seg.tenant_id, seg.id, fetchRes.contacts.length, source, e.message]
        ).catch(()=>{});
        results.push({ segmentId: seg.id, name: seg.name, error: e.message });
      } finally { client.release(); }
    }

    return {
      ok: true,
      ranAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
      contacts: fetchRes.contacts.length,
      source,
      hubspotError: fetchRes.error || null,
      segments: results.length,
      results,
    };
  });
}

let _timer = null, _running = false;
async function _safeRun() {
  if (_running) { console.log('[audiences] sweep skipped — previous still running'); return; }
  _running = true;
  try {
    const s = await runSweepOnce();
    console.log('[audiences] sweep:', JSON.stringify({
      ok: s.ok, segments: s.segments, contacts: s.contacts, source: s.source, ms: s.durationMs
    }));
    // Fire-and-forget: record sweep completion in Marketing Memory per tenant
    if (s.ok && s.results) {
      const byTenant = {};
      for (const r of s.results) {
        // Fetch tenant_id from pool per segment (already in DB context)
        if (r.added > 0 || r.removed > 0) {
          try {
            const { ingestMemoryNode } = require('../knowledge_graph/api');
            const pool = require('../../db').getPool();
            const seg = await pool.query(`SELECT tenant_id, name FROM audience_segments WHERE id=$1`, [r.segmentId]);
            if (seg.rows[0]) {
              const tid = seg.rows[0].tenant_id;
              if (!byTenant[tid]) byTenant[tid] = { added: 0, removed: 0, segments: [] };
              byTenant[tid].added += r.added || 0;
              byTenant[tid].removed += r.removed || 0;
              byTenant[tid].segments.push(seg.rows[0].name || `Segment #${r.segmentId}`);
            }
          } catch (_) {}
        }
      }
      for (const [tid, agg] of Object.entries(byTenant)) {
        try {
          const { ingestMemoryNode } = require('../knowledge_graph/api');
          ingestMemoryNode({
            tenant_id: Number(tid),
            node_type: 'audience_insight',
            summary: `Audience sweep: ${agg.added} contacts joined, ${agg.removed} left across segments: ${agg.segments.join(', ')}.`,
            detail: { added: agg.added, removed: agg.removed, segments: agg.segments },
            source_ref: `audience_sweep:${new Date().toISOString().slice(0, 10)}`,
            importance: 0.5,
          }).catch(() => {});
        } catch (_) {}
      }
    }
  } catch (e) { console.error('[audiences] sweep err:', e.message); }
  finally { _running = false; }
}
function startSweepCron(intervalMinutes = 15) {
  if (_timer) return false;
  setTimeout(_safeRun, 45 * 1000);
  _timer = setInterval(_safeRun, intervalMinutes * 60 * 1000);
  return true;
}

// Webhook path — HubSpot push for a single contact. We re-evaluate that
// contact against every enabled segment across every tenant (the HubSpot
// portal is, today, shared platform-wide). Each membership row is stamped
// with the segment's own tenant_id so cross-tenant leakage is impossible.
async function reevaluateContact(contactId) {
  if (!_db.hasDb()) return { ok:false, error:'db not configured' };
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) return { ok:false, error:'HUBSPOT_PRIVATE_APP_TOKEN missing' };
  return _withLock(async () => {
    const url = `https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(contactId)}?properties=${HUBSPOT_PROPS.join(',')}`;
    const r = await fetch(url, { headers:{ Authorization:`Bearer ${token}` } });
    const j = await r.json();
    if (!r.ok) return { ok:false, error: j.message || `hubspot ${r.status}` };
    const contact = _hubspotToContact(j);
    const pool = _db.getPool();
    const segs = await pool.query(`SELECT * FROM audience_segments WHERE enabled = true`);
    const summary = [];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const seg of segs.rows) {
        try {
          const matches = evaluateContact(seg.rules, contact);
          const cur = await client.query(
            `SELECT 1 FROM audience_segment_members WHERE segment_id=$1 AND contact_id=$2 AND left_at IS NULL`,
            [seg.id, contact.id]
          );
          const isIn = cur.rows.length > 0;
          if (matches && !isIn) {
            await client.query(`
              INSERT INTO audience_segment_members (tenant_id, segment_id, contact_id, contact_email, joined_at, left_at)
              VALUES ($1,$2,$3,$4, now(), NULL)
              ON CONFLICT (segment_id, contact_id) DO UPDATE
                SET tenant_id = COALESCE(EXCLUDED.tenant_id, audience_segment_members.tenant_id),
                    joined_at = now(), left_at = NULL, contact_email = EXCLUDED.contact_email
            `, [seg.tenant_id, seg.id, contact.id, contact.email || null]);
            summary.push({ segmentId: seg.id, tenantId: seg.tenant_id, action: 'joined', segName: seg.name });
          } else if (!matches && isIn) {
            await client.query(
              `UPDATE audience_segment_members SET left_at=now() WHERE segment_id=$1 AND contact_id=$2 AND left_at IS NULL`,
              [seg.id, contact.id]
            );
            summary.push({ segmentId: seg.id, tenantId: seg.tenant_id, action: 'left', segName: seg.name });
          }
        } catch (e) { console.warn(`[audiences-reeval] seg=${seg.id} ${e.message}`); }
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(()=>{});
      throw e;
    } finally { client.release(); }

    for (const ch of summary) {
      const action = ch.action === 'joined' ? 'onJoin' : ch.action === 'left' ? 'onLeave' : null;
      if (!action) continue;
      const calls = [
        _bridge[action](ch.segmentId, contact.id, contact.email, ch.tenantId).catch(e => console.warn(`[audiences→drip] reeval seg=${ch.segmentId}: ${e.message}`)),
        _hsList[action](ch.segmentId, contact.id, contact.email, ch.tenantId).catch(e => console.warn(`[audiences→hslist] reeval seg=${ch.segmentId}: ${e.message}`)),
        _reengage[action](ch.segmentId, contact.id, contact.email, ch.tenantId).catch(e => console.warn(`[audiences→reng] reeval seg=${ch.segmentId}: ${e.message}`)),
      ];
      await Promise.all(calls);
    }
    return { ok:true, contactId: contact.id, email: contact.email, changes: summary };
  });
}

module.exports = { runSweepOnce, startSweepCron, reevaluateContact };

// Dynamic Audiences — sweep engine (Phase 2).
// Pulls all HubSpot contacts (paginated), evaluates each enabled segment,
// diffs against current membership (audience_segment_members), and writes
// the join/leave events. Mutex-guarded single-writer; safe to call from
// the 15-min cron, the manual /refresh endpoint, or the HubSpot webhook.
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
  // Honour HubSpot's 429 with Retry-After (max 3 retries, capped 30s wait)
  if (r.status === 429 && attempt < 3) {
    const wait = Math.min(30, Math.max(1, parseInt(r.headers.get('Retry-After') || '2', 10))) * 1000;
    await new Promise(res => setTimeout(res, wait));
    return _fetchHubspotPage(url, token, attempt + 1);
  }
  // Retry transient 5xx with exponential backoff
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
      // CRITICAL: if we got a partial fetch and bail, leaves would be wrongly
      // applied (contacts that exist but weren't in our fetch). Caller checks
      // result.ok and refuses to apply diffs unless it's true.
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
async function _applySegmentDiff(client, segment, contacts) {
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

  // Current active members for this segment
  const cur = await client.query(
    `SELECT contact_id FROM audience_segment_members WHERE segment_id=$1 AND left_at IS NULL`,
    [segment.id]
  );
  const currentlyIn = new Set(cur.rows.map(r => r.contact_id));

  // Joins: in matchedNow but not currentlyIn
  const joins = [...matchedNow].filter(id => !currentlyIn.has(id));
  // Leaves: in currentlyIn but not matchedNow
  const leaves = [...currentlyIn].filter(id => !matchedNow.has(id));

  // Apply joins. If a row exists with left_at IS NOT NULL (re-entry), reopen it.
  const joinTargets = [];
  for (const cid of joins) {
    const contact = contacts.find(c => c.id === cid);
    await client.query(`
      INSERT INTO audience_segment_members (segment_id, contact_id, contact_email, joined_at, left_at)
      VALUES ($1,$2,$3, now(), NULL)
      ON CONFLICT (segment_id, contact_id) DO UPDATE
        SET joined_at = now(), left_at = NULL, contact_email = EXCLUDED.contact_email
    `, [segment.id, cid, contact?.email || null]);
    joinTargets.push({ id: cid, email: contact?.email || null });
  }
  // Apply leaves — capture the emails BEFORE we mark them left_at so the drip
  // bridge has something to match on.
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
  // Update snapshot count on the segment row
  await client.query(
    `UPDATE audience_segments SET member_count=$1, last_evaluated_at=now(), updated_at=now() WHERE id=$2`,
    [matchedNow.size, segment.id]
  );

  return {
    matched: matchedNow.size,
    added: joins.length,
    removed: leaves.length,
    joinTargets,    // [{id,email}] for drip bridge — fired AFTER commit
    leaveTargets,
  };
}

// ── Mutex (single-writer) ───────────────────────────────────────────────────
let _sweepTail = Promise.resolve();
function _withLock(fn) {
  const next = _sweepTail.then(() => fn(), () => fn());
  _sweepTail = next.catch(() => {});
  return next;
}

// Run the sweep across ALL enabled segments, or just one if segmentId is set.
async function runSweepOnce(opts = {}) {
  if (!_db.hasDb()) return { ok:false, error:'db not configured' };
  return _withLock(async () => {
    const t0 = Date.now();
    const pool = _db.getPool();
    const segs = await pool.query(
      opts.segmentId
        ? `SELECT * FROM audience_segments WHERE id=$1`
        : `SELECT * FROM audience_segments WHERE enabled = true`,
      opts.segmentId ? [Number(opts.segmentId)] : []
    );
    if (!segs.rows.length) return { ok:true, segments:0, note:'no segments to evaluate' };

    // Fetch contacts ONCE per sweep (HubSpot is the heaviest cost).
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
          `INSERT INTO audience_evaluation_log (segment_id, contacts_scanned, members_added, members_removed, duration_ms, source)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [seg.id, fetchRes.contacts.length, r.added, r.removed, Date.now()-segT0, source]
        );
        await client.query('COMMIT');

        // Bridges — fire onJoin/onLeave AFTER commit so a bridge failure can
        // never roll back the membership writes. Best-effort + per-target
        // try/catch, so one failure never blocks subsequent contacts. We
        // run all three bridges (drip, hubspot list, re-engagement) for
        // each contact in parallel for speed.
        const counters = { drip:{j:0,l:0}, hslist:{j:0,l:0}, reng:{j:0,l:0} };
        async function _fanOut(action, targets, counter) {
          for (const t of targets) {
            const calls = [
              _bridge[action](seg.id, t.id, t.email).catch(e => ({ _err:'drip:'+e.message })),
              _hsList[action](seg.id, t.id, t.email).catch(e => ({ _err:'hslist:'+e.message })),
              _reengage[action](seg.id, t.id, t.email).catch(e => ({ _err:'reng:'+e.message })),
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
          `INSERT INTO audience_evaluation_log (segment_id, contacts_scanned, source, error) VALUES ($1,$2,$3,$4)`,
          [seg.id, fetchRes.contacts.length, source, e.message]
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

// ── Cron ────────────────────────────────────────────────────────────────────
let _timer = null, _running = false;
async function _safeRun() {
  if (_running) { console.log('[audiences] sweep skipped — previous still running'); return; }
  _running = true;
  try {
    const s = await runSweepOnce();
    console.log('[audiences] sweep:', JSON.stringify({
      ok: s.ok, segments: s.segments, contacts: s.contacts, source: s.source, ms: s.durationMs
    }));
  } catch (e) { console.error('[audiences] sweep err:', e.message); }
  finally { _running = false; }
}
function startSweepCron(intervalMinutes = 15) {
  if (_timer) return false;
  // First run 45s after boot to avoid hammering HubSpot during cold start
  setTimeout(_safeRun, 45 * 1000);
  _timer = setInterval(_safeRun, intervalMinutes * 60 * 1000);
  return true;
}

// ── Single-contact re-evaluation (called by webhook) ───────────────────────
// Runs all enabled segments against a single freshly-fetched contact and
// writes the join/leave events for that contact only.
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
              INSERT INTO audience_segment_members (segment_id, contact_id, contact_email, joined_at, left_at)
              VALUES ($1,$2,$3, now(), NULL)
              ON CONFLICT (segment_id, contact_id) DO UPDATE SET joined_at = now(), left_at = NULL, contact_email = EXCLUDED.contact_email
            `, [seg.id, contact.id, contact.email || null]);
            summary.push({ segmentId: seg.id, action: 'joined', segName: seg.name });
          } else if (!matches && isIn) {
            await client.query(
              `UPDATE audience_segment_members SET left_at=now() WHERE segment_id=$1 AND contact_id=$2 AND left_at IS NULL`,
              [seg.id, contact.id]
            );
            summary.push({ segmentId: seg.id, action: 'left', segName: seg.name });
          }
        } catch (e) { console.warn(`[audiences-reeval] seg=${seg.id} ${e.message}`); }
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(()=>{});
      throw e;
    } finally { client.release(); }

    // Bridges after commit — best effort, parallel per change.
    for (const ch of summary) {
      const action = ch.action === 'joined' ? 'onJoin' : ch.action === 'left' ? 'onLeave' : null;
      if (!action) continue;
      const calls = [
        _bridge[action](ch.segmentId, contact.id, contact.email).catch(e => console.warn(`[audiences→drip] reeval seg=${ch.segmentId}: ${e.message}`)),
        _hsList[action](ch.segmentId, contact.id, contact.email).catch(e => console.warn(`[audiences→hslist] reeval seg=${ch.segmentId}: ${e.message}`)),
        _reengage[action](ch.segmentId, contact.id, contact.email).catch(e => console.warn(`[audiences→reng] reeval seg=${ch.segmentId}: ${e.message}`)),
      ];
      await Promise.all(calls);
    }
    return { ok:true, contactId: contact.id, email: contact.email, changes: summary };
  });
}

module.exports = { runSweepOnce, startSweepCron, reevaluateContact };

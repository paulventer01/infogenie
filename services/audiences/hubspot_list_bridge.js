// Dynamic Audiences ⇄ HubSpot Static List bridge (Phase 4A).
// On segment join → PUT /crm/v3/lists/{listId}/memberships/add
// On segment leave → PUT /crm/v3/lists/{listId}/memberships/remove
//
// The first time you save a binding without a list_id we auto-create a
// MANUAL (static) list in HubSpot using POST /crm/v3/lists. We never touch
// FILTER-based lists — those are HubSpot-native dynamic lists and writing to
// them via the memberships API errors out. If you want to attach to an
// existing static list, paste its list_id when you save the binding.
const _db = require('../../db');

const HS_BASE = 'https://api.hubapi.com';
function _token() { return process.env.HUBSPOT_PRIVATE_APP_TOKEN; }
function _hasToken() { return !!_token(); }

async function _hubspot(method, path, body) {
  const r = await fetch(HS_BASE + path, {
    method,
    headers: {
      Authorization: `Bearer ${_token()}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch {}
  if (!r.ok) {
    const msg = json.message || json.error || text.slice(0, 240) || `hubspot ${r.status}`;
    const err = new Error(msg); err.status = r.status; throw err;
  }
  return json;
}

async function getBinding(audienceId) {
  if (!_db.hasDb()) return null;
  const r = await _db.getPool().query(
    `SELECT * FROM audience_hubspot_list_bindings WHERE audience_id=$1`, [Number(audienceId)]
  );
  return r.rows[0] || null;
}

async function setBinding(audienceId, payload) {
  if (!_db.hasDb()) throw new Error('db not configured');
  const aid = Number(audienceId);
  if (!Number.isInteger(aid) || aid <= 0) throw new Error('invalid audience_id');
  if (!_hasToken()) throw new Error('HUBSPOT_PRIVATE_APP_TOKEN missing — connect HubSpot first');

  const listName = String(payload?.list_name || '').trim().slice(0, 200);
  if (!listName) throw new Error('list_name required');
  let listId = payload?.list_id ? String(payload.list_id).trim().slice(0, 64) : null;
  const enabled  = payload?.enabled  !== false;
  const autoExit = payload?.auto_exit !== false;

  // Auto-create the static list in HubSpot if no list_id was supplied.
  let createError = null;
  if (!listId) {
    try {
      const created = await _hubspot('POST', '/crm/v3/lists', {
        name: listName,
        objectTypeId: '0-1',     // contact
        processingType: 'MANUAL', // static list (vs DYNAMIC = filter-based)
      });
      listId = String(created?.list?.listId || created?.listId || '');
      if (!listId) throw new Error('HubSpot did not return a listId');
    } catch (e) {
      createError = e.message;
      // We still save the binding so the user can paste a listId manually.
    }
  }

  const r = await _db.getPool().query(`
    INSERT INTO audience_hubspot_list_bindings (audience_id, list_id, list_name, enabled, auto_exit, last_error)
    VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (audience_id) DO UPDATE SET
      list_id    = EXCLUDED.list_id,
      list_name  = EXCLUDED.list_name,
      enabled    = EXCLUDED.enabled,
      auto_exit  = EXCLUDED.auto_exit,
      last_error = EXCLUDED.last_error,
      updated_at = now()
    RETURNING *
  `, [aid, listId, listName, enabled, autoExit, createError]);
  return r.rows[0];
}

async function deleteBinding(audienceId) {
  if (!_db.hasDb()) return false;
  await _db.getPool().query(`DELETE FROM audience_hubspot_list_bindings WHERE audience_id=$1`, [Number(audienceId)]);
  return true;
}

async function _markSynced(audienceId, error) {
  if (!_db.hasDb()) return;
  try {
    await _db.getPool().query(
      `UPDATE audience_hubspot_list_bindings
         SET last_sync_at = now(), last_error = $2, updated_at = now()
       WHERE audience_id = $1`,
      [Number(audienceId), error || null]
    );
  } catch(_) {}
}

async function onJoin(audienceId, contactId, _email) {
  if (!_hasToken() || !_db.hasDb()) return { skipped:'no-hubspot' };
  if (!contactId) return { skipped:'no-contact-id' };
  const b = await getBinding(audienceId);
  if (!b || !b.enabled || !b.list_id) return { skipped:'no-binding' };
  try {
    await _hubspot('PUT', `/crm/v3/lists/${encodeURIComponent(b.list_id)}/memberships/add`,
      [String(contactId)]
    );
    await _markSynced(audienceId, null);
    return { added:true, listId:b.list_id };
  } catch (e) {
    await _markSynced(audienceId, e.message);
    throw e;
  }
}

async function onLeave(audienceId, contactId, _email) {
  if (!_hasToken() || !_db.hasDb()) return { skipped:'no-hubspot' };
  if (!contactId) return { skipped:'no-contact-id' };
  const b = await getBinding(audienceId);
  if (!b || !b.enabled || !b.list_id || !b.auto_exit) return { skipped:'no-binding' };
  try {
    await _hubspot('PUT', `/crm/v3/lists/${encodeURIComponent(b.list_id)}/memberships/remove`,
      [String(contactId)]
    );
    await _markSynced(audienceId, null);
    return { removed:true, listId:b.list_id };
  } catch (e) {
    await _markSynced(audienceId, e.message);
    throw e;
  }
}

module.exports = { getBinding, setBinding, deleteBinding, onJoin, onLeave };

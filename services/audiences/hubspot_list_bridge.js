// Dynamic Audiences ⇄ HubSpot Static List bridge (Phase 4A).
// All five functions accept a tenantId so multi-tenant scoping is enforced
// end-to-end. Tenant is also stamped onto each row on INSERT so direct WHERE
// clauses are fast.
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

async function getBinding(audienceId, tenantId = null) {
  if (!_db.hasDb()) return null;
  if (tenantId != null) {
    const r = await _db.getPool().query(
      `SELECT * FROM audience_hubspot_list_bindings WHERE audience_id=$1 AND tenant_id=$2`,
      [Number(audienceId), tenantId]
    );
    return r.rows[0] || null;
  }
  const r = await _db.getPool().query(
    `SELECT * FROM audience_hubspot_list_bindings WHERE audience_id=$1`, [Number(audienceId)]
  );
  return r.rows[0] || null;
}

async function setBinding(audienceId, payload, tenantId = null) {
  if (!_db.hasDb()) throw new Error('db not configured');
  const aid = Number(audienceId);
  if (!Number.isInteger(aid) || aid <= 0) throw new Error('invalid audience_id');
  if (!_hasToken()) throw new Error('HUBSPOT_PRIVATE_APP_TOKEN missing — connect HubSpot first');

  const listName = String(payload?.list_name || '').trim().slice(0, 200);
  if (!listName) throw new Error('list_name required');
  let listId = payload?.list_id ? String(payload.list_id).trim().slice(0, 64) : null;
  const enabled  = payload?.enabled  !== false;
  const autoExit = payload?.auto_exit !== false;

  let createError = null;
  if (!listId) {
    try {
      const created = await _hubspot('POST', '/crm/v3/lists', {
        name: listName,
        objectTypeId: '0-1',
        processingType: 'MANUAL',
      });
      listId = String(created?.list?.listId || created?.listId || '');
      if (!listId) throw new Error('HubSpot did not return a listId');
    } catch (e) {
      createError = e.message;
    }
  }

  const r = await _db.getPool().query(`
    INSERT INTO audience_hubspot_list_bindings (tenant_id, audience_id, list_id, list_name, enabled, auto_exit, last_error)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (audience_id) DO UPDATE SET
      tenant_id  = COALESCE(EXCLUDED.tenant_id, audience_hubspot_list_bindings.tenant_id),
      list_id    = EXCLUDED.list_id,
      list_name  = EXCLUDED.list_name,
      enabled    = EXCLUDED.enabled,
      auto_exit  = EXCLUDED.auto_exit,
      last_error = EXCLUDED.last_error,
      updated_at = now()
    RETURNING *
  `, [tenantId, aid, listId, listName, enabled, autoExit, createError]);
  return r.rows[0];
}

async function deleteBinding(audienceId, tenantId = null) {
  if (!_db.hasDb()) return false;
  if (tenantId != null) {
    await _db.getPool().query(
      `DELETE FROM audience_hubspot_list_bindings WHERE audience_id=$1 AND tenant_id=$2`,
      [Number(audienceId), tenantId]
    );
  } else {
    await _db.getPool().query(`DELETE FROM audience_hubspot_list_bindings WHERE audience_id=$1`, [Number(audienceId)]);
  }
  return true;
}

async function _markSynced(audienceId, error, tenantId = null) {
  if (!_db.hasDb()) return;
  try {
    if (tenantId != null) {
      await _db.getPool().query(
        `UPDATE audience_hubspot_list_bindings
           SET last_sync_at = now(), last_error = $2, updated_at = now()
         WHERE audience_id = $1 AND tenant_id = $3`,
        [Number(audienceId), error || null, tenantId]
      );
    } else {
      await _db.getPool().query(
        `UPDATE audience_hubspot_list_bindings
           SET last_sync_at = now(), last_error = $2, updated_at = now()
         WHERE audience_id = $1`,
        [Number(audienceId), error || null]
      );
    }
  } catch(_) {}
}

async function onJoin(audienceId, contactId, _email, tenantId = null) {
  if (!_hasToken() || !_db.hasDb()) return { skipped:'no-hubspot' };
  if (!contactId) return { skipped:'no-contact-id' };
  const b = await getBinding(audienceId, tenantId);
  if (!b || !b.enabled || !b.list_id) return { skipped:'no-binding' };
  try {
    await _hubspot('PUT', `/crm/v3/lists/${encodeURIComponent(b.list_id)}/memberships/add`,
      [String(contactId)]
    );
    await _markSynced(audienceId, null, tenantId);
    return { added:true, listId:b.list_id };
  } catch (e) {
    await _markSynced(audienceId, e.message, tenantId);
    throw e;
  }
}

async function onLeave(audienceId, contactId, _email, tenantId = null) {
  if (!_hasToken() || !_db.hasDb()) return { skipped:'no-hubspot' };
  if (!contactId) return { skipped:'no-contact-id' };
  const b = await getBinding(audienceId, tenantId);
  if (!b || !b.enabled || !b.list_id || !b.auto_exit) return { skipped:'no-binding' };
  try {
    await _hubspot('PUT', `/crm/v3/lists/${encodeURIComponent(b.list_id)}/memberships/remove`,
      [String(contactId)]
    );
    await _markSynced(audienceId, null, tenantId);
    return { removed:true, listId:b.list_id };
  } catch (e) {
    await _markSynced(audienceId, e.message, tenantId);
    throw e;
  }
}

module.exports = { getBinding, setBinding, deleteBinding, onJoin, onLeave };

const _db = require('../../db');

async function logAction(tenantId, {
  action_type,
  module,
  title,
  description = null,
  estimated_value = 0,
  currency = 'USD',
  metadata = {}
}) {
  if (!tenantId || !action_type || !module || !title) return;
  try {
    const p = await _db.getPool();
    await p.query(
      `INSERT INTO roi_actions(tenant_id, action_type, module, title, description, estimated_value, currency, metadata)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [tenantId, action_type, module, title, description, +estimated_value || 0, currency, JSON.stringify(metadata)]
    );
  } catch (e) {
    // non-blocking — never let logging failures break the caller
  }
}

module.exports = { logAction };

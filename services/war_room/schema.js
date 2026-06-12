const _db = require('../../db');

async function ensureWarRoomSchema() {
  const p = await _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS war_room_analyses (
      id          SERIAL PRIMARY KEY,
      tenant_id   INT NOT NULL REFERENCES tenants(id),
      competitor  TEXT NOT NULL,
      signals     JSONB NOT NULL DEFAULT '[]',
      prediction  JSONB NOT NULL DEFAULT '{}',
      confidence  INT NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS war_room_analyses_tenant_idx ON war_room_analyses(tenant_id);
  `);
}

module.exports = { ensureWarRoomSchema };

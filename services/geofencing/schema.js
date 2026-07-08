const _db = require('../../db');

async function ensureGeofencingSchema() {
  const p = await _db.getPool();
  
  await p.query(`
    CREATE TABLE IF NOT EXISTS geofences (
      id               SERIAL PRIMARY KEY,
      tenant_id        INT NOT NULL REFERENCES tenants(id),
      name             TEXT NOT NULL,
      lat              DOUBLE PRECISION NOT NULL,
      lng              DOUBLE PRECISION NOT NULL,
      radius_meters    INT NOT NULL DEFAULT 200,
      channel          TEXT NOT NULL, -- email|sms
      message_template TEXT NOT NULL,
      active           BOOLEAN NOT NULL DEFAULT true,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS geofences_tenant_idx ON geofences(tenant_id);
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS geofence_events (
      id               SERIAL PRIMARY KEY,
      tenant_id        INT NOT NULL REFERENCES tenants(id),
      geofence_id      INT NOT NULL REFERENCES geofences(id),
      contact_email    TEXT,
      contact_phone    TEXT,
      lat              DOUBLE PRECISION NOT NULL,
      lng              DOUBLE PRECISION NOT NULL,
      distance_meters  DOUBLE PRECISION NOT NULL,
      triggered_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      delivery_status  TEXT NOT NULL -- sent|failed|skipped:no-provider
    );
    CREATE INDEX IF NOT EXISTS geofence_events_tenant_idx ON geofence_events(tenant_id);
    CREATE INDEX IF NOT EXISTS geofence_events_geofence_idx ON geofence_events(geofence_id);
  `);
}

module.exports = { ensureGeofencingSchema };

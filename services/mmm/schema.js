const _db = require('../../db');

async function ensureMmmSchema() {
  const p = await _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS mmm_models (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      scenario_name VARCHAR(200) NOT NULL,
      inputs JSONB NOT NULL DEFAULT '{}',
      results JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

module.exports = { ensureMmmSchema };

const _db = require('../../db');
async function ensureSeoWidgetSchema() {
  if (!_db.hasDb || !_db.hasDb()) return;
  const pool = _db.getPool(); if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS seo_widget_sites (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      accent TEXT NOT NULL DEFAULT '#0066FF',
      cta_text TEXT NOT NULL DEFAULT 'Get my free SEO audit',
      owner_email TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS seo_widget_leads (
      id SERIAL PRIMARY KEY,
      site_id TEXT NOT NULL REFERENCES seo_widget_sites(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      url TEXT NOT NULL,
      score INTEGER,
      grade TEXT,
      audit_id INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_seowidget_leads_site ON seo_widget_leads(site_id, created_at DESC);
  `);
}
module.exports = { ensureSeoWidgetSchema };

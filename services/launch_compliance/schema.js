const _db = require('../../db');

const DEFAULT_ITEMS = [
  // brand
  { category: 'brand', order_idx: 1,  item: 'Logo is present and matches approved version' },
  { category: 'brand', order_idx: 2,  item: 'Brand colours match approved palette' },
  { category: 'brand', order_idx: 3,  item: 'Font / typography matches brand guidelines' },
  { category: 'brand', order_idx: 4,  item: 'Tone of voice aligns with brand personality' },
  // copy
  { category: 'copy',  order_idx: 5,  item: 'No spelling or grammar errors' },
  { category: 'copy',  order_idx: 6,  item: 'Call-to-action is clear and compelling' },
  { category: 'copy',  order_idx: 7,  item: 'Headline grabs attention and matches audience intent' },
  { category: 'copy',  order_idx: 8,  item: 'Copy has been peer-reviewed' },
  // legal
  { category: 'legal', order_idx: 9,  item: 'Pricing and discounts are accurate and current' },
  { category: 'legal', order_idx: 10, item: 'Terms and conditions link is visible where required' },
  { category: 'legal', order_idx: 11, item: 'Disclaimer is present (if legally required)' },
  { category: 'legal', order_idx: 12, item: 'No misleading claims or superlatives without substantiation' },
  { category: 'legal', order_idx: 13, item: 'Client has signed off on all copy and claims' },
  // mobile
  { category: 'mobile', order_idx: 14, item: 'Landing page renders correctly on iOS (Safari)' },
  { category: 'mobile', order_idx: 15, item: 'Landing page renders correctly on Android (Chrome)' },
  { category: 'mobile', order_idx: 16, item: 'CTA button is visible above the fold on mobile' },
  { category: 'mobile', order_idx: 17, item: 'All forms work and submit correctly on mobile' },
  { category: 'mobile', order_idx: 18, item: 'Page load time is acceptable on 4G (~3s or under)' },
];

async function ensureLaunchComplianceSchema() {
  if (!_db.hasDb()) return;
  const p = _db.getPool();

  await p.query(`
    CREATE TABLE IF NOT EXISTS campaign_compliance_checklists (
      id              SERIAL PRIMARY KEY,
      tenant_id       INT NOT NULL REFERENCES tenants(id),
      campaign_name   TEXT NOT NULL,
      platform        TEXT NOT NULL DEFAULT 'general',
      landing_page_url TEXT,
      ad_copy         TEXT,
      status          TEXT NOT NULL DEFAULT 'in_progress',
      brand_score     INT,
      ai_feedback     JSONB,
      overall_result  TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS compliance_checklist_items (
      id            SERIAL PRIMARY KEY,
      checklist_id  INT NOT NULL REFERENCES campaign_compliance_checklists(id) ON DELETE CASCADE,
      category      TEXT NOT NULL,
      item          TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending',
      notes         TEXT,
      order_idx     INT NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Migrations
  await p.query(`ALTER TABLE campaign_compliance_checklists ADD COLUMN IF NOT EXISTS overall_result TEXT`).catch(() => {});
}

module.exports = { ensureLaunchComplianceSchema, DEFAULT_ITEMS };

const _db = require('../../db');

async function ensureBrandFoundationSchema() {
  if (!_db.hasDb()) return;
  await _db.getPool().query(`
    CREATE TABLE IF NOT EXISTS brand_foundation (
      id INTEGER PRIMARY KEY DEFAULT 1,
      purpose_why TEXT DEFAULT '',
      purpose_beyond_money TEXT DEFAULT '',
      icp_name TEXT DEFAULT '',
      icp_role TEXT DEFAULT '',
      icp_pain TEXT DEFAULT '',
      icp_tried_cheap TEXT DEFAULT '',
      icp_dream_outcome TEXT DEFAULT '',
      voice_tone_warm INTEGER DEFAULT 5,
      voice_tone_witty INTEGER DEFAULT 5,
      voice_tone_bold INTEGER DEFAULT 5,
      voice_we_say TEXT DEFAULT '',
      voice_we_dont_say TEXT DEFAULT '',
      voice_banned_words TEXT DEFAULT '',
      positioning_statement TEXT DEFAULT '',
      positioning_proof TEXT DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT brand_foundation_singleton CHECK (id = 1)
    );
    INSERT INTO brand_foundation (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
  `);
  console.log('[brand-foundation] schema ready');
}

module.exports = { ensureBrandFoundationSchema };

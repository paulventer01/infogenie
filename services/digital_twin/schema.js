const _db = require('../../db');

const TEMPLATES = [
  // Spend & Budget
  { category:'Spend & Budget',      icon:'📈', label:'Increase ad spend by 50%',                           prompt:'What happens if I increase my total advertising budget by 50% across all channels?' },
  { category:'Spend & Budget',      icon:'✂️',  label:'Slash budget by 30% without losing leads',           prompt:'What if I cut my marketing budget by 30%? How do I protect lead volume and revenue?' },
  { category:'Spend & Budget',      icon:'🔄', label:'Reallocate 100% of spend to best channel',            prompt:'What if I moved 100% of my ad budget to my single best-performing channel and paused everything else?' },
  { category:'Spend & Budget',      icon:'🧮', label:'Zero-based budget reset',                             prompt:'What would happen if I started from zero and rebuilt my entire marketing budget from scratch based on ROI data?' },
  // Channel Strategy
  { category:'Channel Strategy',    icon:'✂️',  label:'Cut Meta/Facebook spend to zero',                    prompt:'What if I paused all Meta (Facebook + Instagram) advertising and reallocated that budget elsewhere?' },
  { category:'Channel Strategy',    icon:'🎵', label:'Add TikTok ads channel',                              prompt:'What if I launched TikTok advertising for the first time with a meaningful budget allocation?' },
  { category:'Channel Strategy',    icon:'🔍', label:'Switch from paid ads to SEO-only',                    prompt:'What if I stopped all paid advertising and invested that entire budget into SEO and organic content instead?' },
  { category:'Channel Strategy',    icon:'🔷', label:'Launch LinkedIn B2B campaign',                        prompt:'What if I added LinkedIn advertising to target B2B decision-makers directly?' },
  { category:'Channel Strategy',    icon:'🤳', label:'Go all-in on influencer marketing',                   prompt:'What if I moved 40% of my ad budget into influencer partnerships and UGC instead of paid ads?' },
  { category:'Channel Strategy',    icon:'🤝', label:'Add affiliate marketing channel',                     prompt:'What if I launched an affiliate program offering 20% commission on every sale attributed to affiliates?' },
  // Growth & Expansion
  { category:'Growth & Expansion',  icon:'🌍', label:'Launch in a new country market',                      prompt:'What if I expanded marketing and sales into a new country for the first time?' },
  { category:'Growth & Expansion',  icon:'🏙️', label:'Expand to 3 new cities',                              prompt:'What if I added 3 new major cities to my geographic targeting for paid ads and local SEO?' },
  { category:'Growth & Expansion',  icon:'🚀', label:'Launch a new product line',                           prompt:'What if I launched a complementary new product line aimed at my existing customer base?' },
  { category:'Growth & Expansion',  icon:'💡', label:'Open a second revenue stream',                        prompt:'What if I added a second revenue stream (consulting, subscription, or white-label) alongside my core product?' },
  { category:'Growth & Expansion',  icon:'🎁', label:'Launch a referral program',                           prompt:'What if I launched a referral program giving existing customers 20% off for each new customer they bring in?' },
  // Pricing
  { category:'Pricing',             icon:'💰', label:'Raise prices by 20%',                                 prompt:'What if I increased all my prices by 20%? How would this affect revenue, churn, and new customer acquisition?' },
  { category:'Pricing',             icon:'🆓', label:'Launch freemium tier',                                prompt:'What if I introduced a freemium version of my product to drive top-of-funnel volume?' },
  { category:'Pricing',             icon:'📅', label:'Switch from monthly to annual billing',                prompt:'What if I incentivised customers to switch to annual billing with a 2-month discount?' },
  { category:'Pricing',             icon:'⭐', label:'Introduce a premium tier',                             prompt:'What if I added a premium tier priced 3x higher than my current top plan with exclusive features?' },
  // Creative & Content
  { category:'Creative & Content',  icon:'✉️', label:'Double email marketing frequency',                    prompt:'What if I doubled the frequency of my email marketing from weekly to daily outreach?' },
  { category:'Creative & Content',  icon:'🎬', label:'Hire a full-time content creator',                    prompt:'What if I hired a full-time video/content creator and published 5 pieces of content per week?' },
  { category:'Creative & Content',  icon:'🖼️', label:'Refresh ad creative every 2 weeks',                   prompt:'What if I committed to refreshing all ad creative every two weeks to combat ad fatigue?' },
  // Audience & Targeting
  { category:'Audience & Targeting',icon:'🎯', label:'Launch retargeting campaigns',                        prompt:'What if I launched dedicated retargeting campaigns targeting website visitors and past buyers?' },
  { category:'Audience & Targeting',icon:'👥', label:'Build lookalike audiences from top 1% customers',     prompt:'What if I created lookalike audiences based on my top 1% highest-LTV customers across all ad platforms?' },
];

async function ensureDigitalTwinSchema() {
  const p = await _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS digital_twin_scenarios (
      id            SERIAL PRIMARY KEY,
      tenant_id     INT NOT NULL REFERENCES tenants(id),
      scenario      TEXT NOT NULL,
      question      TEXT NOT NULL,
      results       JSONB NOT NULL DEFAULT '{}',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS digital_twin_scenarios_tenant_idx ON digital_twin_scenarios(tenant_id);
  `);

  await p.query(`ALTER TABLE digital_twin_scenarios ADD COLUMN IF NOT EXISTS scenario_name        TEXT`);
  await p.query(`ALTER TABLE digital_twin_scenarios ADD COLUMN IF NOT EXISTS template_id          INT`);
  await p.query(`ALTER TABLE digital_twin_scenarios ADD COLUMN IF NOT EXISTS share_token         TEXT`);
  await p.query(`ALTER TABLE digital_twin_scenarios ADD COLUMN IF NOT EXISTS comparison_group_id UUID`);
  await p.query(`CREATE UNIQUE INDEX IF NOT EXISTS digital_twin_share_token_uidx ON digital_twin_scenarios(share_token) WHERE share_token IS NOT NULL`);

  await p.query(`
    CREATE TABLE IF NOT EXISTS simulation_templates (
      -- GLOBAL by design: seeded 24-template catalog, UNIQUE(label).
      -- Shared library selected without a tenant filter — not workspace data.
      id          SERIAL PRIMARY KEY,
      category    TEXT NOT NULL,
      icon        TEXT NOT NULL DEFAULT '📊',
      label       TEXT NOT NULL,
      prompt      TEXT NOT NULL,
      sort_order  INT  NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS simulation_templates_category_idx ON simulation_templates(category, sort_order);
  `);

  await p.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS simulation_templates_label_uidx ON simulation_templates(label);
  `).catch(() => {});

  for (let i = 0; i < TEMPLATES.length; i++) {
    const t = TEMPLATES[i];
    await p.query(
      `INSERT INTO simulation_templates(category,icon,label,prompt,sort_order)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT (label) DO UPDATE SET category=$1, icon=$2, prompt=$4, sort_order=$5`,
      [t.category, t.icon, t.label, t.prompt, i]
    );
  }
}

module.exports = { ensureDigitalTwinSchema };

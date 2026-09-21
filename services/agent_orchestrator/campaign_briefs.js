'use strict';
const { canonicalize, sha256Hex } = require('./hash');
const { fail } = require('./errors');

function publicBrief(row) {
  const brief = { id: Number(row.id), brand: row.brand, headline: row.headline,
    greeting: row.greeting, sections: row.sections, signals: row.signals,
    actions: row.actions, generated_by: row.generated_by, content_safety_warnings: row.content_safety_warnings };
  return { ...brief, content_hash: sha256Hex(canonicalize(brief)) };
}

// Bind approval to the selected tenant's saved source, not an arbitrary brief ID.
async function checkMarketingBrief(pool, tenantId, contract) {
  const source = contract.provenance || {};
  if (source.marketing_brief_id == null) return;
  const row = (await pool.query('SELECT * FROM marketing_briefs WHERE tenant_id=$1 AND id=$2',
    [tenantId, source.marketing_brief_id])).rows[0];
  if (!row || publicBrief(row).content_hash !== source.marketing_brief_hash) {
    fail('validation_failed', { field: 'provenance.marketing_brief_id', reason: 'brief_missing_or_changed' });
  }
}

module.exports = { publicBrief, checkMarketingBrief };

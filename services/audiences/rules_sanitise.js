/**
 * Audience segment rules sanitisation — shared contract for conditions arrays.
 * Used by /api/audiences and gated generation normalizers.
 */

function sanitiseAudienceRules(r) {
  if (!r || typeof r !== 'object') return { match: 'all', conditions: [] };
  const match = ['all', 'any', 'none'].includes(String(r.match || '').toLowerCase())
    ? String(r.match).toLowerCase()
    : 'all';
  const conds = Array.isArray(r.conditions) ? r.conditions.slice(0, 30) : [];
  const cleaned = conds.filter((c) => c && typeof c === 'object' && c.type)
    .map((c) => ({
      type: String(c.type).slice(0, 32),
      field: c.field !== undefined ? String(c.field).slice(0, 80) : undefined,
      event: c.event !== undefined ? String(c.event).slice(0, 80) : undefined,
      metric: c.metric !== undefined ? String(c.metric).slice(0, 40) : undefined,
      source: c.source !== undefined ? String(c.source).slice(0, 40) : undefined,
      op: c.op !== undefined ? String(c.op).slice(0, 16) : undefined,
      value: c.value !== undefined
        ? (typeof c.value === 'object' ? null : String(c.value).slice(0, 200))
        : undefined,
      days: c.days !== undefined ? Math.max(0, Math.min(3650, Number(c.days) || 0)) : undefined,
    }));
  return { match, conditions: cleaned };
}

module.exports = { sanitiseAudienceRules };

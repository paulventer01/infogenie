'use strict';
const { MAX_OUTPUT_SCAN_CHARS } = require('../ai_governance/output_gate');

// Scan actual leaf text, including unknown retained fields and JSON keys. Never
// truncate: even warning-only policy cannot approve an unscanned suffix.
function approvalText(row) {
  const parts = [];
  let length = 0, nodes = 0;
  function visit(value, depth = 0) {
    if (++nodes > 20000 || depth > 40) throw new Error('invalid_content');
    if (value == null) return;
    if (typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        if (!Array.isArray(value)) visit(key, depth + 1);
        visit(item, depth + 1);
      }
      return;
    }
    const text = String(value);
    length += text.length + (parts.length ? 1 : 0);
    if (length > MAX_OUTPUT_SCAN_CHARS) throw new Error('invalid_content');
    parts.push(text);
  }
  visit({ title:row.title, proposal:row.proposal, simulation:row.simulation });
  return parts.join('\n');
}
module.exports = { approvalText };

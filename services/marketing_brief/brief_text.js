'use strict';
const { MAX_OUTPUT_SCAN_CHARS } = require('../ai_governance/output_gate');

// Decode retained display text before scanning. Refuse oversized/deep payloads;
// truncation could leave an unsafe suffix in the persisted brief.
function briefText(value) {
  const parts = [];
  let length = 0, nodes = 0;
  function visit(item, depth = 0) {
    if (++nodes > 20000 || depth > 40) throw new Error('invalid_brief_content');
    if (item == null) return;
    if (typeof item === 'object') {
      for (const child of Object.values(item)) visit(child, depth + 1);
      return;
    }
    const text = String(item);
    length += text.length + (parts.length ? 1 : 0);
    if (length > MAX_OUTPUT_SCAN_CHARS) throw new Error('invalid_brief_content');
    parts.push(text);
  }
  visit(value);
  return parts.join('\n');
}
module.exports = { briefText };

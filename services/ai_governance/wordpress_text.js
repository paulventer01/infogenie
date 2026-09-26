'use strict';
const { MAX_OUTPUT_SCAN_CHARS } = require('./output_gate');

// Both WordPress transports scan the exact retained raw fields and decoded HTML.
// Parsing never runs scripts or loads resources. Null means the full scan is too large.
function wordpressGateText(fields) {
  const raw = fields.join('\n');
  if (raw.length > MAX_OUTPUT_SCAN_CHARS) return null;
  const {JSDOM} = require('jsdom');
  const blocks = new Set(['P','DIV','BR','LI','H1','H2','H3','H4','H5','H6','SECTION','ARTICLE','TR','TD',
    'BLOCKQUOTE','PRE','ADDRESS','FIGURE','FIGCAPTION','HEADER','FOOTER','MAIN','NAV','ASIDE',
    'UL','OL','DL','DT','DD','TABLE','TH','HR','FORM','FIELDSET','DETAILS','SUMMARY']);
  const rawText = new Set(['IFRAME','XMP','NOEMBED','NOFRAMES','NOSCRIPT','PLAINTEXT','TEXTAREA','STYLE','SCRIPT','TITLE']);
  const decoded = fields.map(field => {
    const text = [], spaced = [], attributes = [];
    function visit(node, depth = 0) {
      if (node.nodeType === 3) { text.push(node.nodeValue); spaced.push(node.nodeValue); return; }
      if (blocks.has(node.tagName)) text.push(' ');
      if (node.nodeType === 1) spaced.push(' ');
      for (const attr of node.attributes || []) attributes.push(attr.value);
      // KSES may strip a raw-text wrapper and expose its inner HTML. Reparse
      // with the HTML parser (quote-safe), never execute scripts or fetch URLs.
      if (rawText.has(node.tagName) && node.textContent.includes('<')) {
        if (depth >= 8) throw new Error('HTML normalization depth exceeded');
        visit(JSDOM.fragment(node.textContent), depth + 1);
      } else {
        // Template content may become visible after WordPress sanitization.
        for (const child of (node.content || node).childNodes || []) visit(child, depth);
      }
      if (blocks.has(node.tagName)) text.push(' ');
      if (node.nodeType === 1) spaced.push(' ');
    }
    // Parse fields separately: an unclosed tag in a title must not hide body text.
    visit(JSDOM.fragment(field));
    return [text.join(''), attributes.join('\n'), spaced.join('')].join('\n');
  }).join('\n');
  const text = raw + '\n' + decoded;
  return text.length > MAX_OUTPUT_SCAN_CHARS ? null : text;
}
module.exports = { wordpressGateText };

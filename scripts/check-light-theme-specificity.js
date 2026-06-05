#!/usr/bin/env node
// scripts/check-light-theme-specificity.js — Light-theme selector-depth lint
//
// Flags selectors in the [data-theme="light"] block that chain more than
// MAX_DEPTH compound parts (whitespace-separated simple selectors).  Deep
// chains inflate specificity just as badly as !important: future overrides
// must beat them with equally-long chains or add !important.
//
// Example of a flagged pattern (5 parts, exceeds MAX_DEPTH 4):
//   [data-theme="light"] .panel .card .header h2 { … }
//
// EXEMPTIONS (not flagged):
//   1. Selectors containing [style*=…] — targeting inline-style values
//      inherently requires multiple attribute-selector tokens; the extra
//      depth is unavoidable.
//   2. Rule blocks annotated with a "lint-ok-specificity" comment —
//      add `/* lint-ok-specificity: <reason> */` on the opening-brace
//      line to suppress the check for that block.
//
// CONFIGURABLE:
//   MAX_DEPTH env var overrides the default (4).
//   e.g. MAX_DEPTH=5 node scripts/check-light-theme-specificity.js
//
// Run: node scripts/check-light-theme-specificity.js
// npm:  npm run lint:css-specificity

'use strict';

const fs = require('fs');
const path = require('path');

const CSS_FILE = path.join(__dirname, '..', 'style.css');
const LIGHT_SECTION_MARKER = 'LIGHT MODE';
const LIGHT_PREFIX = '[data-theme="light"]';
const STYLE_ATTR = '[style*=';
const LINT_OK_MARKER = 'lint-ok-specificity';

const MAX_DEPTH = parseInt(process.env.MAX_DEPTH || '4', 10);

function stripBlockComments(src) {
  // Replace /* … */ with same-length whitespace so line numbers stay intact.
  return src.replace(/\/\*[\s\S]*?\*\//g, (match) =>
    match.replace(/[^\n]/g, ' ')
  );
}

/**
 * Count the number of whitespace-separated compound-selector tokens in a
 * single simple selector string (child combinators >, siblings ~ + are
 * treated as non-token separators, not counted as parts themselves).
 */
function countCompoundParts(selector) {
  return selector
    .trim()
    .split(/\s+/)
    .filter((tok) => tok && tok !== '>' && tok !== '~' && tok !== '+')
    .length;
}

function check() {
  const rawSrc = fs.readFileSync(CSS_FILE, 'utf8');
  const src = stripBlockComments(rawSrc);

  const lines = src.split('\n');
  const rawLines = rawSrc.split('\n');

  // Locate the light-theme section via the RAW source so the marker survives
  // comment-stripping.
  let sectionStart = -1;
  for (let i = 0; i < rawLines.length; i++) {
    if (
      rawLines[i].includes(LIGHT_SECTION_MARKER) &&
      rawLines[i].includes('data-theme')
    ) {
      sectionStart = i;
      break;
    }
  }
  if (sectionStart === -1) {
    console.error(
      '[css-specificity-lint] ERROR: Could not locate the light-theme section in style.css'
    );
    process.exit(1);
  }

  const flagged = [];

  let selectorBuf = '';
  let inBlock = false;
  let blockIsLintOk = false;
  let blockOpenLine = -1;

  for (let i = sectionStart; i < lines.length; i++) {
    const stripped = lines[i].trim();
    const rawStripped = rawLines[i].trim();

    const hasOpen = stripped.includes('{');
    const hasClose = stripped.includes('}');

    if (!inBlock) {
      if (hasOpen) {
        const beforeBrace = stripped.slice(0, stripped.indexOf('{')).trim();
        const fullSel = (selectorBuf + ' ' + beforeBrace).trim();

        // Check lint-ok annotation on opening-brace line (raw source)
        blockIsLintOk = rawLines[i].includes(LINT_OK_MARKER);
        blockOpenLine = i + 1;

        if (fullSel.includes(LIGHT_PREFIX) && !blockIsLintOk) {
          // Comma-separated selectors — check each part independently.
          for (const part of fullSel.split(',').map((s) => s.trim())) {
            if (!part.includes(LIGHT_PREFIX)) continue;
            if (part.includes(STYLE_ATTR)) continue; // exempt [style*=…]

            const depth = countCompoundParts(part);
            if (depth > MAX_DEPTH) {
              flagged.push({
                selectorLine: i + 1,
                depth,
                selector: part.length > 120 ? part.slice(0, 117) + '…' : part,
              });
            }
          }
        }

        inBlock = !hasClose; // single-line rule already closes
        selectorBuf = '';
      } else {
        // Accumulate selector lines; blank line resets between rule groups.
        if (stripped) {
          selectorBuf += (selectorBuf ? ' ' : '') + stripped;
        } else {
          selectorBuf = '';
        }
      }
    } else {
      // Inside block — lint-ok annotation may appear on any line
      if (rawStripped.includes(LINT_OK_MARKER)) {
        blockIsLintOk = true;
      }
      if (hasClose) {
        inBlock = false;
        selectorBuf = '';
      }
    }
  }

  return { flagged, sectionLine: sectionStart + 1 };
}

if (require.main === module) {
  const { flagged, sectionLine } = check();
  console.log(
    `[css-specificity-lint] Scanning style.css light-theme section (starts line ${sectionLine}), MAX_DEPTH=${MAX_DEPTH}…`
  );

  if (flagged.length === 0) {
    console.log(
      `[css-specificity-lint] OK — no [data-theme="light"] selectors exceed ${MAX_DEPTH} compound parts.`
    );
    process.exit(0);
  }

  console.error(
    `\n[css-specificity-lint] ${flagged.length} over-specific selector(s) in [data-theme="light"] block (depth > ${MAX_DEPTH}):`
  );
  for (const f of flagged) {
    console.error(`  ✗ L${f.selectorLine} (depth ${f.depth}): ${f.selector}`);
  }
  console.error(
    `\n  Fix: flatten the selector — [data-theme="light"] already beats plain class selectors.`
  );
  console.error(
    `  If deep nesting is genuinely required, add a /* lint-ok-specificity: <reason> */`
  );
  console.error(
    `  comment on the opening brace line of the rule block.\n`
  );
  process.exit(1);
}

module.exports = { check, countCompoundParts };

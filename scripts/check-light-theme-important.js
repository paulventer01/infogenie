#!/usr/bin/env node
// scripts/check-light-theme-important.js — Light-theme specificity lint
//
// After removing hundreds of unnecessary !important declarations from the
// [data-theme="light"] section, this script prevents regressions by flagging
// any NEW !important added to a [data-theme="light"] class-only rule block.
//
// WHY: The [data-theme="light"] attribute selector already beats plain class
// selectors in specificity — !important is redundant and raises the arms race,
// making future overrides harder.
//
// ALLOWED: two explicit exceptions (see style.css convention comment):
//   1. Selectors containing [style*=...] — must beat browser inline styles.
//   2. Blocks annotated with a "lint-ok-important" comment — dark base rules
//      that themselves used !important (so the light override must too).
//
// Run: node scripts/check-light-theme-important.js
// npm:  npm run lint:css-important

'use strict';

const fs = require('fs');
const path = require('path');

const CSS_FILE = path.join(__dirname, '..', 'style.css');
const LIGHT_SECTION_MARKER = 'LIGHT MODE';
const LIGHT_PREFIX = '[data-theme="light"]';
const STYLE_ATTR = '[style*=';
const LINT_OK_MARKER = 'lint-ok-important';

function stripBlockComments(src) {
  // Replace /* ... */ comments with whitespace of equal length so line numbers stay intact
  return src.replace(/\/\*[\s\S]*?\*\//g, (match) => {
    const lines = match.split('\n');
    return lines.map((l, i) => (i === 0 ? ' '.repeat(l.length) : ' '.repeat(l.length))).join('\n');
  });
}

function check() {
  const rawSrc = fs.readFileSync(CSS_FILE, 'utf8');

  // Strip block comments so examples inside comments don't trip the lint
  const src = stripBlockComments(rawSrc);
  const lines = src.split('\n');

  // Find start of light-theme section using the RAW source (so the marker is findable)
  const rawLines = rawSrc.split('\n');
  let sectionStart = -1;
  for (let i = 0; i < rawLines.length; i++) {
    if (rawLines[i].includes(LIGHT_SECTION_MARKER) && rawLines[i].includes('data-theme')) {
      sectionStart = i;
      break;
    }
  }
  if (sectionStart === -1) {
    console.error('[css-important-lint] ERROR: Could not locate the light-theme section in style.css');
    process.exit(1);
  }

  const flagged = [];

  // Simple block-level parser:
  //   - Accumulate selector lines until we hit an opening brace.
  //   - Track whether the current block is exempt (selector has [style*= or
  //     block has a lint-ok-important annotation in the raw source).
  //   - Flag any !important found in a non-exempt [data-theme="light"] block.

  let selectorBuf = '';
  let inBlock = false;
  let blockIsLightTheme = false;
  let blockHasStyleAttr = false;
  let blockIsLintOk = false;
  let blockOpenLine = -1;
  let blockSelector = '';

  for (let i = sectionStart; i < lines.length; i++) {
    const stripped = lines[i].trim();
    // For lint-ok-important annotation we must look at RAW line (not comment-stripped)
    const rawStripped = rawLines[i].trim();

    const hasOpen = stripped.includes('{');
    const hasClose = stripped.includes('}');

    if (!inBlock) {
      if (hasOpen) {
        // Everything before { is the selector
        const fullSel = (selectorBuf + ' ' + stripped.slice(0, stripped.indexOf('{'))).trim();
        blockIsLightTheme = fullSel.includes(LIGHT_PREFIX);
        blockHasStyleAttr = fullSel.includes(STYLE_ATTR);
        // lint-ok-important can appear in the opening-brace line (use raw source)
        blockIsLintOk = rawLines[i].includes(LINT_OK_MARKER);
        blockOpenLine = i + 1;
        blockSelector = fullSel;
        inBlock = true;
        selectorBuf = '';

        // Single-line rule: { ... } on same line
        if (hasClose) {
          inBlock = false;
          if (
            blockIsLightTheme &&
            !blockHasStyleAttr &&
            !blockIsLintOk &&
            stripped.includes('!important')
          ) {
            flagged.push({
              line: i + 1,
              content: rawLines[i].trim(),
              selector: fullSel.slice(-120),
              reason:
                '!important is redundant — the [data-theme="light"] attribute selector already beats plain class selectors by specificity',
            });
          }
        }
      } else {
        // Still accumulating selector lines (skip blank / whitespace-only lines)
        if (stripped) {
          selectorBuf += (selectorBuf ? ' ' : '') + stripped;
        } else {
          // Blank line resets selector accumulation between rule groups
          selectorBuf = '';
        }
      }
    } else {
      // Inside a block — check raw line for lint-ok annotation
      if (rawStripped.includes(LINT_OK_MARKER)) {
        blockIsLintOk = true;
      }

      if (stripped.includes('!important') && !hasOpen) {
        if (blockIsLightTheme && !blockHasStyleAttr && !blockIsLintOk) {
          flagged.push({
            line: i + 1,
            content: rawLines[i].trim(),
            blockLine: blockOpenLine,
            selector: blockSelector.slice(-120),
            reason:
              '!important is redundant — the [data-theme="light"] attribute selector already beats plain class selectors by specificity',
          });
        }
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
  console.log(`[css-important-lint] Scanning style.css light-theme section (starts line ${sectionLine})…`);

  if (flagged.length === 0) {
    console.log('[css-important-lint] OK — no unexpected !important found in [data-theme="light"] class-only blocks.');
    process.exit(0);
  }

  console.error(`\n[css-important-lint] ${flagged.length} unexpected !important declaration(s) in [data-theme="light"] class-only blocks:`);
  for (const f of flagged) {
    const loc = f.blockLine ? `block opened at L${f.blockLine}, property at L${f.line}` : `L${f.line}`;
    console.error(`  ✗ ${loc}: ${(f.content || '').slice(0, 100)}`);
    if (f.selector) console.error(`    selector: ${f.selector}`);
    if (f.reason) console.error(`    why: ${f.reason}`);
  }
  console.error('\n  Fix: remove !important (the [data-theme="light"] selector already wins by specificity).');
  console.error('  If !important is genuinely required, add a /* lint-ok-important: <reason> */ comment');
  console.error('  on the opening brace line of the rule block. See style.css convention comment for details.\n');
  process.exit(1);
}

module.exports = { check };

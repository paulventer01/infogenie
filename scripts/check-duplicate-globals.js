#!/usr/bin/env node
// scripts/check-duplicate-globals.js — Duplicate-global ("moved but not removed") lint (Task 132)
//
// app.js (~50k lines) is being split feature-by-feature into public/js/ig_*.js
// modules, each wired into index.html as a plain <script>. Every one of those
// scripts shares the SAME global scope (see .agents/memory/global-name-collisions.md):
// the last <script> to define a given global name silently wins. Two ways this
// quietly ships stale code with NO build/lint failure:
//
//   1. MOVED-BUT-NOT-REMOVED — a view-builder is copied into a public/js module
//      but the original is left behind in app.js. Modules load AFTER app.js, so
//      the module copy wins — but an edit to the orphaned app.js copy looks live
//      and silently does nothing. (Or, if the names are reversed, app.js wins and
//      the "extracted" module is dead.)
//   2. CROSS-MODULE CLASH — two extracted modules each define the same top-level
//      `function X()` (the historical `_trRender` / `_csRender` breaks), so one
//      feature silently runs the other feature's helper.
//
// This lint flags any global *function* (a `function X()` declaration that leaks
// to the global scope, or a `window.X = <function>` export) that is defined in a
// public/js module AND also defined in app.js, OR in a second public/js module.
//
// SCOPE — why functions only, not all `window.X =`:
//   Modules legitimately READ AND WRITE shared *state* left in app.js
//   (window._socialPosts, window._contentTab, analysisData, ...). Those are
//   intentional cross-file state, not duplicated code, so a `window.X = <value>`
//   whose right-hand side is NOT a function is ignored. The hazard this lint
//   targets is the same NAME holding a FUNCTION in two files — that is when one
//   definition silently shadows the other and a feature runs stale code.
//
// IIFE awareness:
//   A file whose first statement is an IIFE (`(function(){ ... })()`) scopes its
//   top-level `function X()` helpers to the file — they do NOT leak. For those
//   files only `window.X = <function>` assignments are global. A file that is NOT
//   IIFE-wrapped leaks every top-level `function X()` to the global scope.
//
// Intentional shared/override globals live in ALLOWLIST with a documented reason.
//
// Run: node scripts/check-duplicate-globals.js   (or: npm run lint)

const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const PUBLIC_JS_DIR = path.join(repoRoot, 'public', 'js');
const APP_JS = path.join(repoRoot, 'app.js');

// Non-runtime files in public/js/ (docs, etc.) — no globals to scan.
const NON_MODULE_FILES = new Set(['README.md']);

// Intentional cross-file globals. Each entry MUST document why the duplicate is
// safe (an intentional load-time wrap/override, or an identical self-contained
// helper copy). Keyed by global name.
const ALLOWLIST = new Map([
  ['_ccGo',
    'Intentional load-time override: ig_creative_suite.js re-defines window._ccGo (originally defined in app.js) to inject the selected language before delegating. Pinned by LOAD_ORDER_CONSTRAINTS in scripts/check-script-tags.js so the wrap always loads after app.js.'],
  ['buildSettings',
    'Intentional load-time wrap: ig_content_pro.js wraps window.buildSettings (defined in ig_settings.js) to inject the WordPress settings card. Pinned by LOAD_ORDER_CONSTRAINTS in scripts/check-script-tags.js so ig_settings.js loads first.'],
  ['_csEsc',
    'Harmless duplicate: ig_creative_suite.js and ig_creator_suite.js each carry an identical, file-self-contained HTML-escape helper. Both are non-IIFE files so the name leaks, but the implementations are identical (see .agents/memory/global-name-collisions.md).'],
  ['_csPost',
    'Harmless duplicate: ig_creative_suite.js and ig_creator_suite.js each carry an equivalent file-self-contained JSON-POST helper; both perform a session-cookie JSON POST (see .agents/memory/global-name-collisions.md).'],
]);

// Browser-owned globals that are never feature exports. `window.onX = ...` event
// handlers (onload, onerror, onresize, ...) are DOM plumbing, not view-builders,
// and are commonly assigned inside generated print-HTML strings. Matched by rule.
function isIgnoredGlobal(name) {
  return /^on[a-z]+$/.test(name);
}

// ── String / template / regex stripping ───────────────────────────────────
// Replaces the CONTENT of '...', "..." and `...` literals (and regex literals,
// and comments) with spaces while preserving newlines (so ^-anchored line scans
// and line numbers stay correct). Two reasons this must be careful:
//   - A `window.X = ...` or `function X()` that lives inside a generated HTML
//     string (e.g. `<script>window.onload=()=>print()</script>`) must NOT be
//     mistaken for a real top-level definition.
//   - A regex literal can contain quote characters (e.g. /[&<>"']/g or /"/g).
//     Without regex awareness, those quotes flip the scanner into a fake string
//     state and silently blank out the REAL definitions that follow — turning a
//     true duplicate into a false negative.
// Template-literal text is blanked; template INTERPOLATION (`${ ... }`) is lexed
// as real code (so its braces, nested templates, strings and regexes are tracked
// correctly — this is what keeps the scanner in sync across the monolith). A
// `window.X = ...` that appears inside an interpolation expression is therefore
// kept, but a top-level definition never lives inside an interpolation, so that
// is harmless. Nesting (template → ${code} → template → ...) is handled with a
// mode stack.
//
// Regex-vs-division is decided by the previous significant token: a `/` begins a
// regex at the start of an expression (after an operator/( [ { , ; : etc., or a
// keyword like `return`), and is division otherwise.
const REGEX_PREFIX_CHARS = new Set([
  '(', '[', '{', ',', ';', ':', '=', '!', '&', '|', '?', '+', '-', '*', '%', '<', '>', '~', '^',
]);
const REGEX_PREFIX_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'do', 'else', 'yield',
  'await', 'case', 'throw',
]);

function stripStrings(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  // Mode stack. Top frame is the current lexing context.
  //   code frame: { t:'code', brace, interp } — brace counts {} so we know which
  //               `}` closes a `${` interpolation (interp=true frames only).
  //   text frames: { t:'sq'|'dq'|'tpl'|'regex'|'line'|'block', inClass? }
  const stack = [{ t: 'code', brace: 0, interp: false }];
  let prevSig = ''; // last significant char emitted in the current code frame
  let prevWord = ''; // last completed identifier token
  let wordBuf = '';

  const top = () => stack[stack.length - 1];
  const onCodeChar = (c) => {
    if (/\s/.test(c)) { if (wordBuf) { prevWord = wordBuf; wordBuf = ''; } return; }
    prevSig = c;
    if (/[A-Za-z0-9_$]/.test(c)) wordBuf += c;
    else if (wordBuf) { prevWord = wordBuf; wordBuf = ''; }
  };
  const leaveCodeInto = (delim) => { if (wordBuf) { prevWord = wordBuf; wordBuf = ''; } prevSig = delim; };
  const backToCode = (delim) => { prevSig = delim; prevWord = ''; wordBuf = ''; };

  while (i < n) {
    const f = top();
    const c = src[i];
    const c2 = src[i + 1];

    if (f.t === 'code') {
      if (c === '/' && c2 === '/') { stack.push({ t: 'line' }); out += '  '; i += 2; continue; }
      if (c === '/' && c2 === '*') { stack.push({ t: 'block' }); out += '  '; i += 2; continue; }
      if (c === '/') {
        const word = wordBuf || prevWord;
        const startsRegex = prevSig === '' || REGEX_PREFIX_CHARS.has(prevSig) ||
          (wordBuf === '' && REGEX_PREFIX_KEYWORDS.has(word));
        if (startsRegex) { stack.push({ t: 'regex', inClass: false }); leaveCodeInto('/'); out += ' '; i++; continue; }
        out += c; onCodeChar(c); i++; continue; // division
      }
      if (c === "'") { stack.push({ t: 'sq' }); leaveCodeInto("'"); out += ' '; i++; continue; }
      if (c === '"') { stack.push({ t: 'dq' }); leaveCodeInto('"'); out += ' '; i++; continue; }
      if (c === '`') { stack.push({ t: 'tpl' }); leaveCodeInto('`'); out += ' '; i++; continue; }
      if (c === '{') { f.brace++; out += c; onCodeChar(c); i++; continue; }
      if (c === '}') {
        if (f.interp && f.brace === 0) { stack.pop(); out += ' '; i++; continue; } // close ${ ... }
        if (f.brace > 0) f.brace--;
        out += c; onCodeChar(c); i++; continue;
      }
      out += c; onCodeChar(c); i++; continue;
    }

    if (f.t === 'line') {
      if (c === '\n') { stack.pop(); out += '\n'; i++; continue; }
      out += ' '; i++; continue;
    }
    if (f.t === 'block') {
      if (c === '*' && c2 === '/') { stack.pop(); out += '  '; i += 2; continue; }
      out += c === '\n' ? '\n' : ' '; i++; continue;
    }
    if (f.t === 'regex') {
      if (c === '\\') { out += '  '; i += 2; continue; }
      if (c === '[') { f.inClass = true; out += ' '; i++; continue; }
      if (c === ']') { f.inClass = false; out += ' '; i++; continue; }
      if (c === '/' && !f.inClass) { stack.pop(); backToCode('/'); out += ' '; i++; continue; }
      out += c === '\n' ? '\n' : ' '; i++; continue;
    }
    if (f.t === 'sq' || f.t === 'dq') {
      if (c === '\\') { out += '  '; i += 2; continue; }
      if ((f.t === 'sq' && c === "'") || (f.t === 'dq' && c === '"')) { stack.pop(); backToCode(c); out += ' '; i++; continue; }
      out += c === '\n' ? '\n' : ' '; i++; continue;
    }
    // template text frame
    if (c === '\\') { out += '  '; i += 2; continue; }
    if (c === '`') { stack.pop(); backToCode('`'); out += ' '; i++; continue; }
    if (c === '$' && c2 === '{') { stack.push({ t: 'code', brace: 0, interp: true }); prevSig = ''; prevWord = ''; wordBuf = ''; out += '  '; i += 2; continue; }
    out += c === '\n' ? '\n' : ' ';
    i++;
  }
  return out;
}

// True if the file's first executable statement is an IIFE wrapper, so its
// top-level `function X()` helpers are file-scoped (do not leak globally).
function isIIFE(src) {
  const stripped = stripStrings(src);
  // Skip leading whitespace, comments (already blanked) and directive prologues.
  let i = 0;
  const n = stripped.length;
  while (i < n) {
    while (i < n && /\s/.test(stripped[i])) i++;
    const rest = stripped.slice(i);
    const dir = /^(['"])\s*\1\s*;?/.exec(rest); // blanked 'use strict' -> quotes only
    if (dir) { i += dir[0].length; continue; }
    break;
  }
  const head = stripped.slice(i);
  return (
    /^[;!+\-~]?\s*\(\s*(async\s+)?function\b/.test(head) ||
    /^[;!+\-~]?\s*\(\s*(async\s+)?\([^)]*\)\s*=>/.test(head) ||
    /^[;!+\-~]?\s*\(\s*(async\s+)?\(?\s*\)?\s*=>/.test(head)
  );
}

// Top-level `function X()` / `async function X()` declarations (column 0).
function topLevelFunctions(stripped) {
  const re = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm;
  const names = new Set();
  let m;
  while ((m = re.exec(stripped)) !== null) names.add(m[1]);
  return names;
}

// `window.X = <function-valued RHS>` exports: function/async-function/arrow
// expressions, or `window.X = someTopLevelFn;` re-attachments.
function windowFunctionExports(stripped, topLevelFnNames) {
  const names = new Set();
  let m;
  const exprRe =
    /(?:^|[^.\w])window\.([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/g;
  while ((m = exprRe.exec(stripped)) !== null) names.add(m[1]);
  const reattachRe = /(?:^|[^.\w])window\.([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*;/g;
  while ((m = reattachRe.exec(stripped)) !== null) {
    if (topLevelFnNames.has(m[2])) names.add(m[1]);
  }
  return names;
}

// Returns the set of global *function* names a source file contributes.
// `treatTopLevelAsGlobal` is true for non-IIFE files (and for app.js, the
// monolith) where top-level `function X()` declarations leak to global scope.
function extractGlobals(src, { treatTopLevelAsGlobal }) {
  const stripped = stripStrings(src);
  const topFns = topLevelFunctions(stripped);
  const winFns = windowFunctionExports(stripped, topFns);
  const out = new Set();
  for (const n of winFns) out.add(n);
  if (treatTopLevelAsGlobal) for (const n of topFns) out.add(n);
  return out;
}

function check() {
  const appSrc = fs.readFileSync(APP_JS, 'utf8');
  const appGlobals = extractGlobals(appSrc, { treatTopLevelAsGlobal: true });

  const moduleFiles = fs
    .readdirSync(PUBLIC_JS_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.js') && !NON_MODULE_FILES.has(e.name))
    .map((e) => e.name)
    .sort();

  // name -> [{file}] across modules
  const byName = new Map();
  for (const file of moduleFiles) {
    const src = fs.readFileSync(path.join(PUBLIC_JS_DIR, file), 'utf8');
    const iife = isIIFE(src);
    const globals = extractGlobals(src, { treatTopLevelAsGlobal: !iife });
    for (const name of globals) {
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(file);
    }
  }

  const collisions = [];
  for (const [name, files] of byName) {
    if (isIgnoredGlobal(name)) continue;
    if (ALLOWLIST.has(name)) continue;

    const inApp = appGlobals.has(name);
    const inMultipleModules = files.length > 1;
    if (!inApp && !inMultipleModules) continue;

    const locations = [...files.map((f) => `public/js/${f}`)];
    if (inApp) locations.unshift('app.js');
    collisions.push({
      name,
      kind: inApp ? 'app-vs-module' : 'module-vs-module',
      locations,
    });
  }
  collisions.sort((a, b) => a.name.localeCompare(b.name));

  return { appGlobals, moduleFiles, byName, collisions };
}

module.exports = {
  check,
  extractGlobals,
  isIIFE,
  stripStrings,
  isIgnoredGlobal,
  ALLOWLIST,
  NON_MODULE_FILES,
};

if (require.main === module) {
  const { moduleFiles, byName, collisions } = check();
  console.log(
    `[duplicate-global-lint] scanned app.js + ${moduleFiles.length} public/js module(s), ${byName.size} distinct module global(s), ${ALLOWLIST.size} allowlisted.`,
  );
  if (collisions.length) {
    console.error(
      `\n[duplicate-global-lint] FAILED — ${collisions.length} global function name(s) defined in two files at once (last <script> silently wins):`,
    );
    for (const c of collisions) {
      console.error(
        `  ✗ ${c.name} (${c.kind})\n` +
          `      defined in: ${c.locations.join(', ')}\n` +
          `      ↳ Remove the stale copy (leave a pointer comment where it moved), rename one helper to a file-unique name, or add "${c.name}" to ALLOWLIST with a documented reason.`,
      );
    }
    process.exit(1);
  }
  console.log(
    '[duplicate-global-lint] OK — no global function is defined in both app.js and a module (or in two modules) outside the allowlist.',
  );
}

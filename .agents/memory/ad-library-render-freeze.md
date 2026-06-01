---
name: Ad Library Spy render freeze
description: The permanent tab freeze when opening Ad Library Spy after an analysis — a MutationObserver feedback loop in the inline "fae" field decorator in app.js
---

# Ad Library Spy render freeze (permanent tab crash)

Symptom: Analyse from home → open menu → click **Ad Library Spy** → the whole
tab freezes permanently (hard freeze; even CDP/profiler locks out with "Target
closed"). Reproduces in a real browser tab AND in a headless puppeteer harness.

**Real cause (definitively confirmed via instrumentation):** a MutationObserver
**feedback loop** in the *inline* field auto-enhancer in app.js (the one that
tags elements `dataset.fae='1'` — `classify`/`enhance`/`makeBrandPicker`, with
a body observer that calls `enhance(n)` on every added INPUT/SELECT/TEXTAREA).
This is a SEPARATE system from `ig_field_enhancer.js`.

The loop: `enhance` classifies a field as `'brand'` → `makeBrandPicker` does
`parentElement.insertBefore(newSelect, input)` → that inserted `<select>` is a
childList mutation → the body observer fires → `enhance(newSelect)` → classified
`'brand'` again → another `<select>` inserted → forever. The DOM grew ~5.4k →
35.7k nodes (~470 select-inserts/sec) until the renderer OOM-crashed.

Why the existing `sibSel !== input` guard in `classify` failed to stop it:
`insertBefore` makes each new select the FIRST `<select>` in the parent, so
`parent.querySelector('select')` returns the new select itself, so
`sibSel === input` and the guard passes every iteration.

**Why data-dependent** (the key tell): `makeBrandPicker` returns early when
`!brand && comps.length === 0`. Empty analysisData → no select inserted → no
loop (just a ~1s blip). Real data (brand + competitors) → select inserted →
infinite loop. So "freezes only with real data" pointed straight at a
data-gated insert inside the decorator, not at the ad-card render.
`makeCountryDropdown` did NOT loop only because it bails on non-`input` tags;
the brand picker had no such guard.

**Fix:** make `enhance` idempotent — `if (input.dataset.fae) return;` at the top
— and tag every generated picker with `dataset.fae='1'` at creation (the brand
picker was missing this; the country picker already had it). Now when the
observer re-enhances a generated `<select>`, it short-circuits. Verified: DOM
node count stays flat, heartbeat survives, no runaway mutation callbacks.

**How to apply (durable rule):** any MutationObserver that mutates the DOM in
response to mutations (inserts/wraps/decorates added nodes) MUST tag what it
creates and skip already-tagged nodes at the TOP of the handler — before any
classify/insert. A guard that infers "already done" from sibling/parent state
(e.g. `querySelector('select')`) is fragile: insertion order or wrapping can
defeat it. Tag-and-skip on the element itself is the only reliable break.

## Earlier wrong hypotheses (do not repeat)
- Field-enhancer listener leak / scanRoot chunking (`ig_field_enhancer.js`) —
  real hygiene but never the cause.
- Ad-card render (Meta padding 300/country, big `map().join('')`+innerHTML) —
  plausible freeze hazard in general, but NOT this freeze. The ad-library list
  render is still worth capping/chunking defensively, but it was a red herring
  here; the crash happened during navigation/decoration, before any search.

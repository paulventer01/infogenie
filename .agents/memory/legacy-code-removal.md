---
name: Legacy dashboard code removal
description: How the duplicate legacy SPA code was removed after full React migration, and the guards/tests that pin the new shape.
---

# Legacy dashboard code removal

After every dashboard view was ported to React, the duplicate legacy code was deleted: view-builder modules removed from `public/js/` (only shared/chrome modules survive), migrated `#view-*` divs stripped from `index.html`, and dead `navigateTo` dispatch blocks deleted from `app.js`.

**Rules for future work:**
- Any bare reference in `app.js` to a builder that may not exist must be guarded (`window.buildX && buildX()`), including `_bgBuild` queue entries, DOMContentLoaded warm-ups, and modal keydown handlers.
- Some modules look deletable but are load-bearing for surviving surfaces (e.g. home-view onclicks, alerts-panel helpers) — grep index.html + app.js templates for every exported global before deleting a module.
- Test floors are pinned to the post-removal counts (`MIN_VIEW_PANEL_COUNT`, `MIN_COVERED_BUILDERS`, chart/section data-mode gate floors, script-tag count). Deleting/adding legacy surface means re-tuning those floors deliberately, not reverting them.
- `test/migrated-builders-safety.test.js` now only tests the ported React logic (buildVsCards placeholder coercion); its legacy stripped-DOM half died with the legacy builders.
- Views retired into hub views live in `VIEW_ID_ALIASES` (lib/viewRoutes.ts) and are exempted from the lockstep orphan check.

**Why:** deleting legacy modules without auditing consumers causes silent `ReferenceError`s at load or on stray onclicks; the guard pattern + floors make wholesale regressions loud while tolerating intentional shrinkage.

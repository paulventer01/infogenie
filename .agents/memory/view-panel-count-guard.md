---
name: View-panel bulk-removal guard test
description: Adding any new #view-* panel to index.html can fail test/legacy-shell-hydration.test.js's floor-staleness check.
---

`test/legacy-shell-hydration.test.js` has two tests guarding against accidental bulk removal of `id="view-*"` panels from `index.html`: a floor test (`bodyHtml` has at least `MIN_VIEW_PANEL_COUNT` panels) and a staleness test (the live count in `index.html` must stay within 20 of that floor).

**Why:** the staleness gap is intentionally tight (20), so adding even a single new view panel (e.g. wiring a new feature into the legacy shell) can push the live count more than 20 above the constant and fail CI with a message that looks unrelated to your change.

**How to apply:** whenever you add a new `<div class="view ..." id="view-*">` to `index.html`, recount live panels (`grep -o 'id="view-[^"]*"' index.html | wc -l`) and bump `MIN_VIEW_PANEL_COUNT` in `test/legacy-shell-hydration.test.js` to at least `(liveCount - 20)`, updating the comment above it too.

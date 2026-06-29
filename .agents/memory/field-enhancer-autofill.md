---
name: Field-enhancer autofill suppression
description: How the global field enhancer kills Chromium saved-email/password autofill leakage app-wide.
---

# Chromium autofill suppression

`ig_field_enhancer.js` applies `autocomplete="new-password"` (+ `data-lpignore`,
`data-1p-ignore`, `data-form-type="other"`) to every free-text input/textarea the
SPA renders, via a `suppressAutofill()` pass wired into the same scan/MutationObserver
pipeline as AI-Suggest decoration (`processField` = suppress then decorate).

**Why:** Chromium ignores `autocomplete="off"` and uses its own form-shape ML to
stuff saved emails/passwords into plain text fields. `new-password` is the reliable
bypass. Doing it centrally means any new view/feature is covered without per-form edits.

**How to apply / edge cases:**
- Only `type=text`, no-type, and `<textarea>` are rewritten. `email`/`url`/`tel`/`search`/`password`/structured types are left to the browser.
- Real auth forms are exempt via `closest('#igAuthWall, #igForgotForm, #ig-reset-form, [data-auth-form]')` — they intentionally autofill.
- Fields that already declare a *meaningful* `autocomplete` token (`KEEP_AUTOCOMPLETE` set: email/url/name/username/organization/address-*/cc-*/current-password/etc.) are honoured, not overridden. `off`/`on` are treated as no-intent and get suppressed.
- Marker `data-ig-no-autofill="1"` makes it idempotent.
- Guard test: `test/field-enhancer-autofill.test.js`. Bump the `?v=` on the script tag in `index.html` when editing the enhancer.

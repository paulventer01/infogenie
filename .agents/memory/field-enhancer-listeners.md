---
name: Field enhancer global-listener leak
description: Why per-instance window listeners in ig_field_enhancer.js must be single delegated listeners, not one-per-decorated-field.
---

# Field enhancer must use ONE delegated listener per global event, never one-per-field

The global field enhancer decorates every input/textarea the SPA renders. Views
constantly swap `innerHTML` (each navigation rebuilds the view), so any global
(`window`) listener attached *per decorated field* accumulates without bound:
the old fields leave the DOM but their listeners (and the detached nodes they
close over) stay attached to `window` forever.

**Why:** the competitor-picker used to do `window.addEventListener('ig:analysis-updated', rebuild)`
inside `buildCompetitorSelect`, once per picker. After an analyse run the
pre-built heavy views hold hundreds of brand/competitor fields, and every
revisit re-decorates fresh fields — so the listener count climbed unbounded
(measured ~240 after prebuild, +N per navigation) while only a handful of
pickers were ever actually in the DOM. That runaway accumulation + retained
detached `<select>`s is what locked the main thread (the "page unresponsive"
freeze opening Ad Library Spy after analyse).

**How to apply:** for any cross-cutting event the enhancer reacts to, wire a
SINGLE shared listener (guarded by a module-level `_wired` flag), and have it
act on whatever matching elements are *currently in the DOM*
(`document.querySelectorAll(...)`). Store any per-element data the handler needs
on the element itself (e.g. a `data-` attribute) instead of capturing it in a
per-element closure. Detached elements then fall out of the query naturally and
get GC'd — no teardown bookkeeping required.

The regression guard lives at `test/field-enhancer-listener-leak.test.js`: it
boots `ig_field_enhancer.js` in jsdom, instruments `window.addEventListener`,
and asserts the `ig:analysis-updated` listener count stays ≤1 across heavy
decoration + repeated navigation.

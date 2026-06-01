---
name: Ad Library Spy render freeze
description: Why the Ad Library Spy page froze after a search, and the durable rule for rendering large result lists in app.js
---

# Ad Library Spy render freeze

The page froze AFTER running an ad-library search (not on view-open). Two prior
attempts wrongly blamed the field enhancer (listener leak, scanRoot chunking) —
those were real hygiene fixes but never the cause.

**Real cause:** the Meta backend pads results up to 300 ads PER country
(`services/ad_library/api.js` MAX_PADDED). The client fanned out fetches across
every selected country × platform with `Promise.all` (worst case ~98×5), then
rendered EVERY merged ad into one synchronous `block.innerHTML` string — each
card carrying a `JSON.stringify`'d Save button. A few hundred cards built in one
pass = multi-second main-thread block.

**Fix shape (app.js, ad-library funcs):** bounded-concurrency fan-out
(`_alMapLimit`, limit 6), hard cap merged ads (~150) with a visible
"Showing first N of M" note, and render cards in rAF-yielding chunks
(append shell first, stream batches, bail if `grid.isConnected` is false).

**Why:** a large brand or multi-country search produces thousands of nodes;
the diagnostic heartbeat stops at 15s so the freeze never showed in early logs.

**How to apply (durable rule):** any app.js view that renders an unbounded
result list via `arr.map(...).join('')` + `innerHTML` is a freeze hazard once
the backend can return hundreds+ of items. Cap the list, surface the cap, and
chunk the DOM insertion with rAF. Check the backend's max-return before assuming
a render path is safe.

---
name: Llama RapidAPI integration
description: How Meta Llama 3.2 Vision is wired in via RapidAPI; shared helper location; cascade pattern; JSX regex caveat.
---

## The rule
`callLlama(messages, opts)` and `hasLlama()` live in `services/ai_compat.js` and are exported alongside `normalizeChatParams`. Any service that wants Llama just does `const { callLlama, hasLlama } = require('../ai_compat')`.

## Key constants
- Host: `meta-llama-3-2-vision.p.rapidapi.com`
- Model ID: `meta-llama/Llama-3.2-11B-Vision-Instruct-Turbo`
- Key env var: `RAPIDAPI_KEY`
- Platform-keys REGISTRY entry: group `AI Models`, test tag `rapidapi_llama`

## Cascade pattern (market_signals)
Cloudflare Workers AI is tried first (when `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_AI_TOKEN` are set); RapidAPI Llama is the fallback. Both resolve to the same `llama` key in the results array so the downstream model list is unchanged.

## model_compare wiring
`MODELS` map entry uses `provider:'rapidapi_llama'`. The `/models` availability check and `/run` dispatch both branch on this provider string.

## SWC JSX caveat
**Why:** SWC (Next.js compiler) misparses `/regex/g` literal syntax when it appears inside a JSX attribute expression — it reads the first `/` as a division operator and the second as the start of another division, leaving an unterminated expression. TSC accepts it fine; only SWC fails.

**How to apply:** Never write `/pattern/flags` regex literals directly inside JSX `{}` expressions. Use `new RegExp(...)` or equivalent string methods (`.split(" ").join("")` instead of `.replace(/\s+/g, "")`) when inside JSX text or attribute values.

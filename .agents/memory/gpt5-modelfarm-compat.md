---
name: gpt-5 modelfarm param compatibility
description: Durable rules for running gpt-5* (reasoning) models on the OpenAI Chat Completions API / modelfarm proxy.
---

# gpt-5* reasoning models need different chat params than gpt-4o

**Rule:** Any `gpt-5*` chat-completions request must (1) use `max_completion_tokens`,
not `max_tokens`; (2) omit non-default `temperature`/`top_p`/penalties; (3) set
`reasoning_effort:'minimal'` unless reasoning is genuinely wanted.

**Why:** gpt-5* are reasoning models. The API hard-rejects `max_tokens` and
non-default sampling params (400), and without `reasoning_effort:'minimal'` the model
spends the whole completion budget on hidden reasoning tokens and returns EMPTY
content. With `minimal`, `reasoning_tokens=0` and it behaves like a fast
gpt-4o-mini-style model (works with `response_format:json_object`). A naive
model-string swap from gpt-4o-mini therefore breaks every call.

**How to apply:** Don't hand-fix call sites — normalization is centralized and applied
at two layers so it covers every transport, current and future:
- The shared OpenAI SDK class is prototype-patched once (covers all
  `openai.chat.completions.create` callers, since they share one class via module cache).
- Raw `fetch` and `http(s).request` are globally intercepted: any body sent to a
  `chat/completions` URL naming a gpt-5* model is rewritten on the wire (Content-Length
  fixed). Strictly scoped — non-chat URLs and non-gpt-5 bodies pass through untouched.
Both layers are installed at server boot. A guard test fires real fetch + http.request
at a local server and asserts the captured bytes are normalized — keep it green.

**Exclusion:** model strings sent to a THIRD-PARTY engine API (not our OpenAI) must keep
the literal vendor name, e.g. `gpt-4o-mini` for DataForSEO's external LLM-engine maps.
Normalization is also scoped to skip those (they aren't OpenAI chat/completions calls).

**Verify end-to-end:** a gpt-5* call should return content with
`completion_tokens_details.reasoning_tokens:0`.

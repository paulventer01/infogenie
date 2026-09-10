# Billy chat (xAI)

Billy is InfoGenie’s marketing assistant. Express exposes chat over the xAI Responses API. Dummy or missing `XAI_API_KEY` returns HTTP 503 — never a fake assistant reply.

## Endpoints

| Method | Path | Notes |
|---|---|---|
| `POST` | `/v1/billy/chat` | Non-streaming JSON. Temporary `INFOGENIE_API_TOKEN` Bearer stub. |
| `POST` | `/v1/billy/chat/stream` | SSE (`text/event-stream`). Same token stub. |
| `POST` | `/api/billy/chat` | Same handlers. Existing `/api/*` session or `INFOGENIE_API_KEY` gate + permission matrix (`dashboard.view`). |
| `POST` | `/api/billy/chat/stream` | SSE alias under `/api/*`. |
| `GET` | `/api/health` | Existing liveness probe. |
| `GET` | `/health` | Thin alias of the same liveness JSON (`{ ok, status: "alive", ts }`). |

Do not mount Billy at `/api/v1/billy` — the permission-matrix coverage test reduces mounts to the first `/api/<segment>`.

## Request body

```json
{
  "message": "Draft three launch headlines.",
  "threadId": null,
  "previousResponseId": null,
  "userId": "optional-user",
  "context": { "product": "InfoGenie", "locale": "en-ZA" }
}
```

`message` is required (non-empty string). Other fields are optional. Missing `threadId` allocates a new `thr_…` id. `previousResponseId` falls back to the last remembered id for that thread.

## Non-stream response

```json
{
  "ok": true,
  "threadId": "thr_…",
  "responseId": "resp_…",
  "message": { "role": "assistant", "content": "…" },
  "usage": { "inputTokens": 0, "outputTokens": 0, "totalTokens": 0 }
}
```

Errors: `400` `{ ok:false, error:"validation_failed", issues }`, `503` `{ ok:false, error:"xai_not_configured", message }` (dummy/missing xAI key), `502`/`500` `{ ok:false, error }`.

## SSE events

- `event: delta` / `data: {"text":"…"}`
- `event: done` / `data: {"responseId":"…","threadId":"…","usage":{…}}`
- `event: error` on failure (including `xai_not_configured`)

## Environment

| Variable | Purpose |
|---|---|
| `XAI_API_KEY` | Platform xAI key. Dummy (`_DUMMY…`) or unset → 503. |
| `XAI_MODEL` | Defaults to `grok-4.6`. |
| `PORT` | Public Next port (default `5000`). Express stays on `8000`. |
| `INFOGENIE_API_TOKEN` | If set, `/v1/billy/*` requires `Authorization: Bearer …`. If unset, allowed in non-production with a one-time console warning. Production without a token is rejected. |
| `INFOGENIE_API_KEY` | Existing `/api/*` gate (session cookie or Bearer / `X-InfoGenie-Key`). |

## curl

Non-stream (token unset in local dev):

```bash
curl -sS -X POST http://localhost:8000/v1/billy/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"Suggest three content angles.","context":{"product":"InfoGenie","locale":"en-ZA"}}'
```

With the token stub:

```bash
curl -sS -X POST http://localhost:8000/v1/billy/chat \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${INFOGENIE_API_TOKEN}" \
  -d '{"message":"Write a short product hook."}'
```

SSE stream:

```bash
curl -sS -N -X POST http://localhost:8000/v1/billy/chat/stream \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${INFOGENIE_API_TOKEN}" \
  -d '{"message":"Outline a 7-day launch plan."}'
```

Session / API-key alias (dashboard clients):

```bash
curl -sS -X POST http://localhost:8000/api/billy/chat \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${INFOGENIE_API_KEY}" \
  -d '{"message":"Help me plan a campaign."}'
```

Liveness:

```bash
curl -sS http://localhost:8000/api/health
curl -sS http://localhost:8000/health
```

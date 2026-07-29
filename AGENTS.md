# AGENTS.md

## Cursor Cloud specific instructions

InfoGenie is an AI marketing-intelligence platform. Local dev runs **two Node processes** started together by `npm run dev` (see `scripts/dev.js`):

- **Next.js** — public front door on **port 5000** (auth pages `/login` etc. + React dashboard). Open this in the browser.
- **Express** — backend on internal **port 8000** (whole `/api/*` surface + legacy assets). Next proxies everything it doesn't own to Express, so it's a single same-origin at `:5000`.

Standard commands live in `package.json` / `replit.md`; don't duplicate them. Key gotchas below.

### Startup (services are NOT auto-started by the update script)

1. **PostgreSQL** is installed locally but must be started each session:
   `sudo pg_ctlcluster 16 main start`
   DB `infogenie` and role `postgres` (password `postgres`) already exist in the snapshot.
2. **Export dev env vars** before `npm run dev` (this app has no dotenv — it reads `process.env` directly):
   ```
   export DATABASE_URL="postgres://postgres:postgres@localhost:5432/infogenie"
   export CREDENTIAL_ENCRYPTION_KEY="$(openssl rand -base64 32)"
   export SESSION_SECRET="dev-session-secret"
   export INFOGENIE_API_KEY="dev-infogenie-api-key"
   ```
3. `npm run dev` → browse `http://localhost:5000`. First sign-up auto-becomes the owner and is auto-logged-in.

### Non-obvious caveats

- **Postgres is optional to *boot* but required for real use.** Without `DATABASE_URL` the server still starts, but auth returns `503`, sessions are in-memory, and there is **no JSON-file fallback** for app data (the `data/*.json` stores were migrated to the Postgres `kv_store`). Always run with `DATABASE_URL` set.
- **`db.js` forces SSL** (`ssl:{rejectUnauthorized:false}`). The local Ubuntu Postgres already has SSL on (snakeoil cert), so `localhost` connects fine — don't disable SSL.
- **`node server.js` alone defaults Express to port 5000** (collides with Next) and serves only a 503 retirement notice at `/`. Use `npm run dev`, not the bare server.
- **Test gate: use `npm run test:core`** (fast, deterministic, ~1s, 57 cases). The full `npm test` is known to **hang after passing** (jsdom timers keep the event loop alive — see `scripts/run-core-tests.js`), so it is not a reliable gate.
- **Node version:** repo targets Node 20 (`.replit`). The cloud VM's default `node` (`/exec-daemon/node`) is v22, which runs dev/lint/`test:core` fine. Node 20 is installed via `nvm` (`nvm use 20`) if you need the repo's exact target; note the full `node --test test/` directory-arg form only works on Node 20.
- **Harmless boot noise:** `[t35] ... must be marked IMMUTABLE`, `[optimizer] column "campaign_id" does not exist`, `[t116] getDb is not a function`, and `Port 80 unavailable (EACCES)` are pre-existing and non-blocking.
- **Lint:** `npm run lint` runs custom fabrication/script-tag/CSS checks (not ESLint). `npm run lint:next` is the Next/ESLint layer.

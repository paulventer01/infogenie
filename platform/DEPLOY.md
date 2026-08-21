# Deploying the InfoGenie platform (getting a public URL)

The stack is one Node process tree: Express API + Next.js console (single
origin) + PostgreSQL. `scripts/deploy-start.mjs` boots the whole thing —
migrations, least-privilege role, demo seed, API, console — from a single
`DATABASE_URL`.

## Replit (recommended — matches the existing workspace)

1. **Create the Repl.** Replit → *Create Repl* → *Import from GitHub* →
   `paulventer01/infogenie`. In the shell, switch to the platform branch:
   `git checkout claude/new-project-45hku7`.
2. **Add a database.** Left sidebar → *PostgreSQL* → create. Replit sets
   `DATABASE_URL` automatically.
3. **Add Secrets** (Tools → Secrets):
   - `ANTHROPIC_API_KEY` — your key (flips the engine LIVE)
   - `HASH_PEPPER` — any long random string; generate once and never change it
4. **Install and run.** In the shell:
   ```sh
   cd platform && npm ci && cd web && npm ci && cd ..
   node scripts/deploy-start.mjs
   ```
   The console binds to `$PORT`; Replit's webview/preview URL is your test URL.
5. **Keep it running** (optional): *Deploy* → *Reserved VM* (the cron/agent
   parts of the roadmap need a VM deployment, per the integrations spec §18)
   with run command `cd platform && node scripts/deploy-start.mjs` and build
   command `cd platform && npm ci && cd web && npm ci && npx next build`.
   The deployment URL (`https://<name>.<user>.replit.app`) is shareable.

Sign in with `demo@infogenie.app` / `demo-pass-1` (change after first login in
a real deployment — or create your own users via the identity tables).

## Any other host (Railway, Render, a VM…)

Requirements: Node 22+, a PostgreSQL 16 database, outbound HTTPS.

```sh
export DATABASE_URL=postgres://…      # the managed database's owner URL
export ANTHROPIC_API_KEY=sk-ant-…     # optional; mock engine without it
export HASH_PEPPER=<stable secret>
cd platform && npm ci && (cd web && npm ci)
node scripts/deploy-start.mjs         # serves the console on $PORT (default 3000)
```

Notes:
- The script rotates the `infogenie_app` role password on every boot and uses
  it for the request path (RLS-enforced). If the host disallows role
  management it falls back to the owner connection — `FORCE ROW LEVEL
  SECURITY` still applies to the owner, so tenant isolation holds either way.
- `HASH_PEPPER` must stay stable across restarts: suppression hashes, session
  token hashes, and the credential-vault key all derive from it.
- The demo seed runs only when the `users` table is empty.

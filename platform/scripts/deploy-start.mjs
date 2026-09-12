#!/usr/bin/env node
// One-command production start for a hosted deployment (Replit, Railway,
// Render, a VM…). Point DATABASE_URL at the host's managed Postgres and run
// this script; it will
//
//   1. apply migrations with the privileged (owner) connection,
//   2. rotate the least-privilege infogenie_app role's password and build the
//      RLS-enforced application connection string from it (falling back to the
//      owner connection — still covered by FORCE RLS — if the host disallows
//      role management),
//   3. seed the demo tenant on an empty database,
//   4. start the platform API (internal port) and the Next.js console on the
//      public $PORT, which proxies /api and /auth to the API (single origin).
//
// Required env:  DATABASE_URL   (the managed database's connection string)
// Recommended:   HASH_PEPPER    (stable secret; hashes/vault key derive from it)
//                ANTHROPIC_API_KEY (flips the engine LIVE)
// Optional:      PORT (public web port, default 3000), API_PORT (default 4000)

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const platformDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const webDir = join(platformDir, "web");

const adminUrl = process.env.ADMIN_DATABASE_URL || process.env.DATABASE_URL;
if (!adminUrl) {
  console.error("deploy-start: set DATABASE_URL to your managed Postgres connection string.");
  process.exit(1);
}
if (!process.env.HASH_PEPPER) {
  console.warn(
    "deploy-start: HASH_PEPPER is not set — using the dev default. Set a stable secret " +
    "before storing real credentials or suppression data (changing it later starts a new hash namespace).",
  );
}

const apiPort = Number(process.env.API_PORT ?? 4000);
const webPort = Number(process.env.PORT ?? 3000);

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: platformDir, ...opts });
  if (r.status !== 0) {
    console.error(`deploy-start: \`${cmd} ${args.join(" ")}\` failed (exit ${r.status}).`);
    process.exit(r.status ?? 1);
  }
};

// 1. Migrations (idempotent) — includes the code-catalog sync.
console.log("deploy-start: applying migrations…");
run("npx", ["tsx", "src/migrate.ts"], {
  env: { ...process.env, ADMIN_DATABASE_URL: adminUrl, DATABASE_URL: adminUrl },
});

// 2. Least-privilege app connection: rotate infogenie_app's password and build
//    its URL from the admin URL (same host/db/params, different credentials).
let appUrl = adminUrl;
const admin = new pg.Client({ connectionString: adminUrl });
await admin.connect();
try {
  const appPassword = process.env.INFOGENIE_APP_DB_PASSWORD || randomBytes(24).toString("base64url");
  await admin.query(`alter role infogenie_app login password '${appPassword.replace(/'/g, "''")}'`);
  const candidate = new URL(adminUrl);
  candidate.username = "infogenie_app";
  candidate.password = appPassword;
  const probe = new pg.Client({ connectionString: candidate.toString() });
  await probe.connect();
  await probe.query("select 1");
  await probe.end();
  appUrl = candidate.toString();
  console.log("deploy-start: request path uses the least-privilege infogenie_app role (RLS-enforced).");
} catch (err) {
  console.warn(
    `deploy-start: could not switch to the infogenie_app role (${String(err).slice(0, 120)}); ` +
    "using the owner connection — FORCE ROW LEVEL SECURITY still applies to it.",
  );
}

// 3. Seed the demo tenant once, on an empty database.
const { rows } = await admin.query("select count(*)::int as n from users");
if (rows[0].n === 0) {
  console.log("deploy-start: empty database — seeding the demo tenant…");
  run("npx", ["tsx", "scripts/seed-demo.ts"], {
    env: { ...process.env, DATABASE_URL: appUrl, ADMIN_DATABASE_URL: adminUrl },
  });
}
await admin.end();

// 4. Build the console once (first boot), then start API + web.
// Rewrite targets are resolved into the production build, so the API URL must
// be present at build time (not only at `next start`).
const platformApiUrl = `http://127.0.0.1:${apiPort}`;
if (!existsSync(join(webDir, ".next", "BUILD_ID"))) {
  console.log("deploy-start: building the console (first boot)…");
  run("npx", ["next", "build"], { cwd: webDir, env: { ...process.env, PLATFORM_API_URL: platformApiUrl } });
}

console.log(`deploy-start: starting API on :${apiPort} and console on :${webPort}…`);
// Children run in their own process groups so shutdown reaps grandchildren
// (npx → tsx/next) too — otherwise a restart on the same VM hits EADDRINUSE.
const api = spawn("npx", ["tsx", "src/server.ts"], {
  stdio: "inherit",
  cwd: platformDir,
  detached: true,
  env: { ...process.env, DATABASE_URL: appUrl, ADMIN_DATABASE_URL: adminUrl, PORT: String(apiPort) },
});
const web = spawn("npx", ["next", "start", "-H", "0.0.0.0", "-p", String(webPort)], {
  stdio: "inherit",
  cwd: webDir,
  detached: true,
  env: { ...process.env, PLATFORM_API_URL: platformApiUrl },
});

const killGroup = (child) => {
  try { process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ }
};
let shuttingDown = false;
const bail = (which) => (code) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.error(`deploy-start: ${which} exited (${code}); shutting down.`);
  killGroup(api);
  killGroup(web);
  process.exit(code ?? 1);
};
api.on("exit", bail("API"));
web.on("exit", bail("console"));
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    shuttingDown = true;
    killGroup(api);
    killGroup(web);
    process.exit(0);
  });
}

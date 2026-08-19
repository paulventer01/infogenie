#!/usr/bin/env node
// Dev launcher: runs the existing Express server and Next.js side-by-side.
//
//   - Express  → internal port 8000 (serves the legacy SPA + the whole /api/*
//                surface, exactly as before; EXPRESS_PORT overrides its
//                preview listen in services/competitor_detect/routes.js)
//   - Next.js  → port 5000, the Replit webview/preview port. It owns the new
//                auth pages and proxies everything else to Express via the
//                rewrites in next.config.ts.
//
// We avoid the `concurrently` package (its `shell-quote` dependency is blocked
// by the security firewall) and spawn the two processes directly.
const { spawn } = require("child_process");
const path = require("path");

const EXPRESS_PORT = process.env.EXPRESS_PORT || "8000";
const NEXT_PORT = process.env.NEXT_PORT || "5000";
const nextBin = path.join(__dirname, "..", "node_modules", ".bin", "next");

const procs = [];
let shuttingDown = false;

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const p of procs) {
    try {
      p.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
  process.exit(code);
}

function run(name, command, args, extraEnv) {
  const child = spawn(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
  procs.push(child);
  child.on("exit", (code, signal) => {
    if (!shuttingDown) {
      console.log(`[dev] ${name} exited (code=${code} signal=${signal}) — shutting down both servers`);
    }
    shutdown(code == null ? 0 : code);
  });
  child.on("error", (err) => {
    console.error(`[dev] failed to start ${name}:`, err.message);
    shutdown(1);
  });
  return child;
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

// NEXT_FRONT_DOOR tells Express that Next.js owns `/` (the SPA shell). Express
// still serves /index.html, all assets and the /api/* surface, but stops
// serving the legacy SPA at the root so Next's dashboard shell is authoritative
// in dev. Prod (plain `node server.js`, no flag) keeps serving index.html at /.
// Preview/dev enforces the route permission matrix unless the operator
// explicitly sets PERMISSION_ENFORCEMENT (off | shadow | on). Replit already
// sets this via userenv; Cursor Cloud start scripts did not. Mode is read at
// Express module load, so this must be on the child env — not a secret.
run("express", "node", ["server.js"], {
  EXPRESS_PORT,
  NEXT_FRONT_DOOR: "1",
  PERMISSION_ENFORCEMENT: process.env.PERMISSION_ENFORCEMENT || "on",
});
run("next", nextBin, ["dev", "-p", NEXT_PORT], {
  EXPRESS_PROXY_TARGET: `http://localhost:${EXPRESS_PORT}`,
});

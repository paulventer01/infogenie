#!/usr/bin/env node
// Production launcher: runs the existing Express server and Next.js side-by-side,
// the production mirror of scripts/dev.js.
//
//   - Express  → internal port 8000 (EXPRESS_PORT; NOT the public webview port).
//                Serves the whole /api/* surface, /index.html, all legacy static
//                assets (app.js, data.js, public/js/*, style.css, /uploads, …)
//                and the standalone auth HTML pages, exactly as before. The
//                NEXT_FRONT_DOOR=1 flag stops it serving the legacy SPA at `/`
//                so Next's React shell is authoritative there.
//   - Next.js  → port 5000, the public webview/deployment port. Runs `next start`
//                against the prebuilt `.next` output (NODE_ENV=production). It owns
//                the React dashboard + auth pages and proxies everything else to
//                Express via the rewrites in next.config.ts.
//
// Both processes share the same origin (the browser only ever talks to Next on
// 5000) so the `infogenie.sid` session cookie keeps working across the boundary.
//
// Crash handling mirrors scripts/dev.js: if either process dies the launcher
// tears down the other and exits non-zero, so the platform restarts the whole
// thing cleanly rather than leaving a half-up state.
//
// We avoid the `concurrently` package (its `shell-quote` dependency is blocked
// by the security firewall) and spawn the two processes directly.
const { spawn } = require("child_process");
const path = require("path");

const EXPRESS_PORT = process.env.EXPRESS_PORT || "8000";
// Next must own the public webview/deployment port. Honour PORT (set by some
// hosting platforms) but default to 5000 (the Replit webview port).
const NEXT_PORT = process.env.PORT || process.env.NEXT_PORT || "5000";
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
      console.log(`[start] ${name} exited (code=${code} signal=${signal}) — shutting down both servers`);
    }
    shutdown(code == null ? 0 : code);
  });
  child.on("error", (err) => {
    console.error(`[start] failed to start ${name}:`, err.message);
    shutdown(1);
  });
  return child;
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

// Express: internal port, production mode, and NEXT_FRONT_DOOR so it cedes `/`
// to Next while still serving /index.html, every asset and the /api/* surface.
run("express", "node", ["server.js"], {
  EXPRESS_PORT,
  NEXT_FRONT_DOOR: "1",
  NODE_ENV: "production",
});

// Next.js: public webview port, production server against the prebuilt .next
// output, proxying everything it doesn't own back to internal Express.
run("next", nextBin, ["start", "-p", NEXT_PORT], {
  NODE_ENV: "production",
  EXPRESS_PROXY_TARGET: `http://localhost:${EXPRESS_PORT}`,
});

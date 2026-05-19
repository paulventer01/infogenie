#!/bin/bash
# Post-merge setup for InfoGenie.
# Runs after a task agent's branch merges into main. Must be idempotent
# and non-interactive (stdin is closed). Server boot already migrates
# Postgres schemas (every service has its own ensure<Tier>Schema IIFE),
# so we only need to make sure new npm dependencies are installed.
set -e

if [ -f package.json ]; then
  echo "[post-merge] npm install"
  npm install --no-audit --no-fund --silent
fi

echo "[post-merge] done"

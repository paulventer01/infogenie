import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Workspace } from "./types";

const DATA_DIR = join(process.cwd(), ".data");
const WS_PATH = join(DATA_DIR, "workspace.json");

function ensure() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

export function readWorkspace(): Workspace | null {
  ensure();
  if (!existsSync(WS_PATH)) return null;
  try {
    return JSON.parse(readFileSync(WS_PATH, "utf8")) as Workspace;
  } catch {
    return null;
  }
}

export function writeWorkspace(ws: Workspace): Workspace {
  ensure();
  writeFileSync(WS_PATH, JSON.stringify(ws, null, 2), "utf8");
  return ws;
}

export function createWorkspace(email: string): Workspace {
  const ws: Workspace = {
    id: randomUUID(),
    email: email.trim().toLowerCase(),
    createdAt: new Date().toISOString(),
    analysis: null,
    drafts: [],
    campaigns: [],
    sequences: [],
    results: null,
  };
  return writeWorkspace(ws);
}

export function requireWorkspace(): Workspace {
  const ws = readWorkspace();
  if (!ws) throw new Error("no_workspace");
  return ws;
}

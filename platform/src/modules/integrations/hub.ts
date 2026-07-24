import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { config } from "../../config/env.js";
import { INTEGRATION_CATALOG } from "./registry.js";

/**
 * The integration hub. Two jobs:
 *
 * 1. Credential vault — tenant-scoped connector secrets, write-only. Stored
 *    AES-256-GCM-encrypted with an app-layer key (a managed KMS in production);
 *    only a last-4 display hint is ever readable back.
 *
 * 2. Evidence fetch — the data step of the signal-to-action loop. For a
 *    capability's bound providers, the hub returns retrieval evidence for the
 *    grounded-generation pipeline (§5.5 steps 2–3). Adapters are mock-first:
 *    with no live credential they return deterministic, clearly-labelled
 *    simulated evidence, so every feature has a working end-to-end path; a
 *    live credential + adapter flips a provider to real data with no change
 *    to the capability. Either way the evidence is UNTRUSTED external content
 *    (§7.3) — the gateway delimits it and never lets it sit in instruction
 *    position.
 */

// ---------- credential vault ----------

function vaultKey(): Buffer {
  // Derived from the platform secret; a dedicated KMS-managed key in production.
  return createHash("sha256").update(`vault:${config.hashPepper}`).digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", vaultKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [iv.toString("base64"), cipher.getAuthTag().toString("base64"), enc.toString("base64")].join(".");
}

export function decryptSecret(stored: string): string {
  const [iv, tag, data] = stored.split(".");
  const decipher = createDecipheriv("aes-256-gcm", vaultKey(), Buffer.from(iv!, "base64"));
  decipher.setAuthTag(Buffer.from(tag!, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data!, "base64")), decipher.final()]).toString("utf8");
}

export async function saveCredential(
  client: PoolClient,
  args: { integrationKey: string; secret: string; createdBy?: string },
): Promise<{ hint: string }> {
  if (!INTEGRATION_CATALOG.some((i) => i.key === args.integrationKey)) {
    throw new Error(`Unknown integration: ${args.integrationKey}`);
  }
  const hint = args.secret.slice(-4);
  await client.query(
    `insert into tenant_integration_credentials (tenant_id, integration_key, secret_encrypted, secret_hint, created_by)
     values (app_current_tenant(), $1, $2, $3, $4)
     on conflict (tenant_id, integration_key)
       do update set secret_encrypted = excluded.secret_encrypted,
                     secret_hint = excluded.secret_hint,
                     rotated_at = now()`,
    [args.integrationKey, encryptSecret(args.secret), hint, args.createdBy ?? null],
  );
  return { hint };
}

export async function connectedIntegrations(client: PoolClient): Promise<Map<string, { hint: string }>> {
  const { rows } = await client.query(
    `select integration_key, secret_hint from tenant_integration_credentials`,
  );
  return new Map(rows.map((r) => [r.integration_key, { hint: r.secret_hint }]));
}

// ---------- evidence adapters (mock-first) ----------

export interface EvidenceBlock {
  provider: string;
  mode: "live" | "mock";
  text: string;
}

/** Deterministic pseudo-metrics so mock evidence is stable per (provider, subject). */
function seeded(provider: string, subject: string, min: number, max: number): number {
  const h = createHash("sha256").update(`${provider}|${subject}`).digest();
  return min + (h.readUInt32BE(0) % (max - min + 1));
}

type MockAdapter = (subject: string) => string;

/** One evidence generator per provider family. Output is intentionally shaped
 * like the real provider's data so live adapters slot in without prompt
 * changes. Every mock is labelled simulated. */
const MOCK_ADAPTERS: Record<string, MockAdapter> = {
  dataforseo: (s) =>
    `SERP snapshot (simulated) for "${s}": avg position ${seeded("dfs-pos", s, 4, 28)}, search volume ${seeded("dfs-vol", s, 800, 24000)}/mo, keyword difficulty ${seeded("dfs-kd", s, 18, 74)}/100, top competitor URLs: 3 tracked, rank trend last 30d: ${seeded("dfs-tr", s, 0, 1) ? "improving" : "slipping"}.`,
  firecrawl: (s) =>
    `Page crawl (simulated) of the target relating to "${s}": pricing tier block detected (3 tiers), last content change ${seeded("fc-d", s, 1, 21)} days ago, ${seeded("fc-w", s, 350, 2400)} words, 2 CTAs, no schema markup on page.`,
  perplexity: (s) =>
    `Web research digest (simulated) on "${s}": ${seeded("pplx-n", s, 3, 9)} recent sources found; notable signals — a competitor announcement within the last fortnight, hiring activity in growth roles, and mixed customer sentiment on review platforms (avg ${(seeded("pplx-r", s, 31, 45) / 10).toFixed(1)}/5).`,
  builtwith: (s) =>
    `Tech stack scan (simulated) for "${s}": CMS WordPress, analytics GA4 + Hotjar, ads Meta Pixel + Google Ads tag, email Klaviyo, CDN Cloudflare, chat Intercom.`,
  meta_ads: (s) =>
    `Ad library sample (simulated) for "${s}": ${seeded("meta-n", s, 2, 14)} active ads, formats video ${seeded("meta-v", s, 20, 80)}% / static rest, longest-running ad live ${seeded("meta-d", s, 12, 160)} days, primary hook: value/price framing.`,
  tiktok_ads: (s) =>
    `TikTok ad sample (simulated) for "${s}": ${seeded("tt-n", s, 1, 8)} active ads, avg duration ${seeded("tt-s", s, 9, 34)}s, creator-led UGC style dominates.`,
  hubspot: (s) =>
    `CRM snapshot (simulated) for "${s}": ${seeded("hs-c", s, 120, 4200)} contacts in scope, ${seeded("hs-d", s, 3, 40)} open deals, last sync 2h ago.`,
  amplitude: (s) =>
    `Analytics snapshot (simulated) for "${s}": WoW sessions ${seeded("amp-s", s, 0, 1) ? "+" : "-"}${seeded("amp-p", s, 2, 18)}%, conversion rate ${(seeded("amp-c", s, 8, 46) / 10).toFixed(1)}%, top entry page /pricing.`,
  apollo: (s) =>
    `Lead sample (simulated) for "${s}": ${seeded("ap-n", s, 15, 240)} matching contacts, ICP fit high for ${seeded("ap-f", s, 20, 65)}%, common titles: marketing lead, growth manager.`,
  pagespeed: (s) =>
    `Web vitals (simulated) for "${s}": LCP ${(seeded("ps-l", s, 18, 42) / 10).toFixed(1)}s, CLS 0.0${seeded("ps-c", s, 1, 9)}, INP ${seeded("ps-i", s, 90, 380)}ms, performance score ${seeded("ps-p", s, 38, 92)}/100.`,
  google_trends: (s) =>
    `Trend curve (simulated) for "${s}": 12-month interest ${seeded("gt-t", s, 0, 1) ? "rising" : "flat"}, seasonal peak in ${["March", "June", "September", "November"][seeded("gt-m", s, 0, 3)]}, related rising query: "${s} pricing".`,
  reddit: (s) =>
    `Community pulse (simulated) for "${s}": ${seeded("rd-n", s, 4, 30)} relevant threads this month, sentiment ${["cautiously positive", "mixed", "frustrated with incumbents"][seeded("rd-s", s, 0, 2)]}, recurring question: "is it worth the price?"`,
  youtube: (s) =>
    `Comment mining (simulated) for "${s}": ${seeded("yt-n", s, 40, 900)} comments analysed, top themes: pricing clarity, delivery speed, comparisons with alternatives.`,
  quora: (s) =>
    `Question mining (simulated) for "${s}": ${seeded("qr-n", s, 3, 22)} active questions, highest-traffic: "What is the best option for ${s}?"`,
  trustpilot_g2: (s) =>
    `Review aggregation (simulated) for "${s}": avg rating ${(seeded("rv-r", s, 32, 47) / 10).toFixed(1)}/5 across platforms, praise: service quality; complaints: response times, ${seeded("rv-d", s, 0, 3)} review(s) disappeared since last scan.`,
  news_api: (s) =>
    `News scan (simulated) for "${s}": ${seeded("nw-n", s, 1, 12)} stories in the last 7 days, none crisis-grade, one sector piece on pricing pressure.`,
  zernio: (s) =>
    `Social snapshot (simulated) for "${s}": follower growth +${seeded("zr-f", s, 1, 9)}% MoM, best-performing format: short video, optimal posting window detected 17:00–19:00.`,
  slack: () => `Alert routing target (simulated): #marketing-signals channel connected, escalation to on-call enabled.`,
  google_maps: (s) =>
    `Local scan (simulated) for "${s}": ${seeded("gm-n", s, 8, 60)} matching businesses in radius, ${seeded("gm-r", s, 10, 45)}% without a website — outreach candidates.`,
  wordpress: () => `Publishing target (simulated): WordPress site connected, category "Insights", author "Marketing".`,
  resend: () => `Delivery channel (simulated): sending domain authenticated (SPF/DKIM/DMARC pass), reputation pool healthy.`,
};

const DEFAULT_ADAPTER: MockAdapter = (s) => `Provider data (simulated) relating to "${s}".`;

/**
 * Fetch retrieval evidence for a capability run. Live adapters engage when a
 * tenant credential exists for a provider; otherwise the deterministic mock
 * serves, clearly labelled. (No live adapters ship in this build — the vault
 * and interface are the contract they plug into.)
 */
export async function fetchEvidence(
  client: PoolClient,
  capabilityKey: string,
  subject: string,
): Promise<EvidenceBlock[]> {
  const { rows } = await client.query(
    `select integration_key from capability_integrations where capability_key = $1`,
    [capabilityKey],
  );
  if (rows.length === 0) return [];
  const connected = await connectedIntegrations(client);
  return rows.map((r) => {
    const key = r.integration_key as string;
    // Credentialed providers would route to a live adapter here; until one
    // ships, evidence stays simulated (and says so) even when connected.
    const adapter = MOCK_ADAPTERS[key] ?? DEFAULT_ADAPTER;
    return { provider: key, mode: connected.has(key) ? "mock" : "mock", text: adapter(subject) } as EvidenceBlock;
  });
}

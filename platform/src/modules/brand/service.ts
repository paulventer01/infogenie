import type { PoolClient } from "pg";
import { withTenant } from "../../db/tenantContext.js";
import { appendWith } from "../audit/service.js";

/** Block 2 — Brand Foundation: versioned, auditable, injected into every
 * generation path. Saving a new version supersedes the current one atomically,
 * so history is retained and any output can be traced to the exact brand
 * version that grounded it. */

export interface BrandFoundationInput {
  companyName: string;
  mission?: string;
  positioning?: string;
  voiceTone?: string;
  keyMessages?: string[];
  differentiators?: string[];
  competitors?: string[];
  icp?: Record<string, unknown>;
  prohibitedTerms?: string[];
  mandatoryDisclaimers?: string[];
  claimRules?: Record<string, unknown>;
}

export interface BrandFoundation extends BrandFoundationInput {
  id: string;
  version: number;
}

export async function saveBrandFoundation(
  tenantId: string,
  input: BrandFoundationInput,
  actor: { actorId?: string },
): Promise<BrandFoundation> {
  return withTenant(tenantId, async (client) => {
    const { rows: prev } = await client.query(
      `update brand_foundations set is_current = false where is_current returning version`,
    );
    const version = prev.length > 0 ? (prev[0].version as number) + 1 : 1;

    const { rows } = await client.query(
      `insert into brand_foundations
         (tenant_id, version, company_name, mission, positioning, voice_tone,
          key_messages, differentiators, competitors, icp,
          prohibited_terms, mandatory_disclaimers, claim_rules, created_by)
       values (app_current_tenant(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       returning id`,
      [
        version,
        input.companyName,
        input.mission ?? null,
        input.positioning ?? null,
        input.voiceTone ?? null,
        input.keyMessages ?? [],
        input.differentiators ?? [],
        input.competitors ?? [],
        JSON.stringify(input.icp ?? {}),
        input.prohibitedTerms ?? [],
        input.mandatoryDisclaimers ?? [],
        JSON.stringify(input.claimRules ?? {}),
        actor.actorId ?? null,
      ],
    );

    await appendWith(client, {
      actorType: "user",
      actorId: actor.actorId,
      action: "brand.foundation_saved",
      resourceType: "brand_foundation",
      resourceId: rows[0].id,
      evidence: { version, supersedes: version - 1 || null },
      outcome: "saved",
    });

    return { id: rows[0].id, version, ...input };
  });
}

export interface LoadedBrand {
  id: string;
  version: number;
  companyName: string;
  voiceTone: string | null;
  positioning: string | null;
  keyMessages: string[];
  differentiators: string[];
  competitors: string[];
  prohibitedTerms: string[];
  mandatoryDisclaimers: string[];
  claimRules: Record<string, unknown>;
  contextBlock: string;
}

/** Load the current Brand Foundation inside an existing tenant transaction.
 * Returns null when none exists — callers must treat that as "generation not
 * permitted", never as "proceed ungrounded". */
export async function loadCurrentBrand(client: PoolClient): Promise<LoadedBrand | null> {
  const { rows } = await client.query(
    `select * from brand_foundations where is_current limit 1`,
  );
  if (rows.length === 0) return null;
  const r = rows[0];

  const contextBlock = [
    `Company: ${r.company_name}`,
    r.positioning ? `Positioning: ${r.positioning}` : null,
    r.mission ? `Mission: ${r.mission}` : null,
    r.voice_tone ? `Voice & tone: ${r.voice_tone}` : null,
    r.key_messages?.length ? `Key messages: ${r.key_messages.join("; ")}` : null,
    r.differentiators?.length ? `Differentiators: ${r.differentiators.join("; ")}` : null,
    r.competitors?.length ? `Named competitors: ${r.competitors.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    id: r.id,
    version: r.version,
    companyName: r.company_name,
    voiceTone: r.voice_tone,
    positioning: r.positioning,
    keyMessages: r.key_messages ?? [],
    differentiators: r.differentiators ?? [],
    competitors: r.competitors ?? [],
    prohibitedTerms: r.prohibited_terms ?? [],
    mandatoryDisclaimers: r.mandatory_disclaimers ?? [],
    claimRules: r.claim_rules ?? {},
    contextBlock,
  };
}

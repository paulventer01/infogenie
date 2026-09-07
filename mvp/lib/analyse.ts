import type { Analysis } from "./types";

function brandFromDomain(domain: string): string {
  const host = domain
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split("/")[0]
    .split(":")[0];
  const root = host.split(".")[0] || "Brand";
  return root.charAt(0).toUpperCase() + root.slice(1);
}

function industryGuess(domain: string, industry?: string): string {
  if (industry?.trim()) return industry.trim();
  const d = domain.toLowerCase();
  if (/trade|forex|broker|fintech|bank|pay/.test(d)) return "Fintech & Finance";
  if (/shop|store|commerce|apparel/.test(d)) return "Ecommerce";
  if (/saas|cloud|dev|api/.test(d)) return "B2B SaaS";
  return "Professional Services";
}

/** Deterministic Day-1 scaffold when no LLM key is configured. */
export function scaffoldAnalysis(input: {
  domain: string;
  industry?: string;
}): Analysis {
  const domain = input.domain
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/$/, "")
    .split("/")[0];
  const brandName = brandFromDomain(domain);
  const industry = industryGuess(domain, input.industry);
  const rivals =
    industry === "Fintech & Finance"
      ? [
          { name: "Revolut", domain: "revolut.com" },
          { name: "eToro", domain: "etoro.com" },
          { name: "N26", domain: "n26.com" },
        ]
      : industry === "Ecommerce"
        ? [
            { name: "Shopify Merchants", domain: "shopify.com" },
            { name: "Amazon", domain: "amazon.com" },
            { name: "Etsy", domain: "etsy.com" },
          ]
        : [
            { name: "Category Leader", domain: "leader.example" },
            { name: "Challenger Co", domain: "challenger.example" },
            { name: "Niche Rival", domain: "niche.example" },
          ];

  return {
    domain,
    brandName,
    industry,
    summary: `${brandName} competes in ${industry}. This MVP scaffold maps rivals, demand keywords, creative angles, and a first-week action stack so you can brief campaigns without leaving the loop.`,
    analysedAt: new Date().toISOString(),
    source: "scaffold",
    competitors: rivals.map((r, i) => ({
      name: r.name,
      domain: r.domain,
      positioning:
        i === 0
          ? "Category mindshare + polished acquisition funnel"
          : i === 1
            ? "Aggressive paid social + referral loops"
            : "Niche messaging with tighter ICP focus",
      strength: i === 0 ? "Brand trust" : i === 1 ? "Creative velocity" : "Specialist proof",
      weakness: i === 0 ? "Slower messaging tests" : i === 1 ? "Generic claims" : "Limited reach",
      estimatedTraffic: ["2.4M", "1.1M", "420K"][i],
      adPresence: (["High", "High", "Medium"] as const)[i],
    })),
    ads: [
      {
        platform: "Meta",
        advertiser: rivals[0].name,
        headline: `Switch to ${rivals[0].name} in minutes`,
        body: "Social proof + fee comparison. Soft CTA to mobile onboarding.",
        cta: "Get started",
        angle: "Switching friction",
      },
      {
        platform: "Google",
        advertiser: rivals[1].name,
        headline: `${industry} platform ranked for intent`,
        body: "Search ads on high-intent comparison terms.",
        cta: "Compare plans",
        angle: "Comparison capture",
      },
      {
        platform: "TikTok",
        advertiser: rivals[2].name,
        headline: "Day-in-the-life founder POV",
        body: "UGC-style trust builder; comments drive site visits.",
        cta: "Learn more",
        angle: "Authenticity",
      },
    ],
    keywords: [
      {
        keyword: `best ${industry.toLowerCase()} platform`,
        volume: "12K",
        difficulty: "High",
        intent: "Commercial",
        opportunity: "Own comparison content vs top rival",
      },
      {
        keyword: `${brandName.toLowerCase()} vs ${rivals[0].name.toLowerCase()}`,
        volume: "1.8K",
        difficulty: "Medium",
        intent: "Commercial",
        opportunity: "Battle card → landing page",
      },
      {
        keyword: `how to choose ${industry.toLowerCase()} tools`,
        volume: "6.4K",
        difficulty: "Medium",
        intent: "Informational",
        opportunity: "Blog → nurture sequence",
      },
      {
        keyword: `${industry.toLowerCase()} pricing`,
        volume: "8.1K",
        difficulty: "High",
        intent: "Transactional",
        opportunity: "Transparent pricing module on LP",
      },
    ],
    techSignals: ["Google Tag Manager", "Meta Pixel", "Intercom-class chat", "CDN + modern JS stack"],
    pricingSignals: [
      "Freemium or trial entry common in category",
      "Rivals lead with fee comparison in paid social",
      "Annual plan discount used as conversion lever",
    ],
    swot: {
      strengths: [`Focused ${industry} offer`, "Room to out-message sluggish leaders"],
      weaknesses: ["Lower unaided awareness than category leaders", "Thin content footprint vs rivals"],
      opportunities: [
        `Win "${brandName} vs ${rivals[0].name}" SERP`,
        "Creative tests on switching + proof angles",
      ],
      threats: ["Paid CPMs rising in category", "Leaders copying niche messaging"],
    },
    actions: [
      {
        title: "Publish vs-rival landing page",
        why: "Captures high-intent comparison demand this week",
        channel: "SEO + Paid",
        effort: "M",
      },
      {
        title: "Ship 3 Meta creatives on switching friction",
        why: "Matches dominant rival angle with sharper proof",
        channel: "Meta",
        effort: "S",
      },
      {
        title: "Cold email ICP from VoC language",
        why: "Turns analysis language into pipeline this sprint",
        channel: "Email",
        effort: "S",
      },
    ],
    brand: {
      voice: `Clear, confident, practical — ${brandName} speaks like an expert operator, not a hype deck.`,
      tone: ["Direct", "Credible", "Energetic"],
      colors: { primary: "#0B3D4A", accent: "#E8A838", ink: "#102027" },
      doSay: ["Proof over promises", "Specific outcomes", "Plain-language offers"],
      dontSay: ["World-class synergy", "Disrupt everything", "Guaranteed riches"],
    },
  };
}

export async function runAnalysis(input: {
  domain: string;
  industry?: string;
}): Promise<Analysis> {
  const base = scaffoldAnalysis(input);
  const key = process.env.OPENAI_API_KEY || process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return base;

  try {
    const prompt = `Return STRICT JSON for a marketing competitive analysis of domain "${base.domain}" in industry "${base.industry}".
Shape: {
  "summary": string,
  "competitors": [{"name","domain","positioning","strength","weakness","estimatedTraffic","adPresence":"High"|"Medium"|"Low"}],
  "ads": [{"platform":"Meta"|"Google"|"TikTok","advertiser","headline","body","cta","angle"}],
  "keywords": [{"keyword","volume","difficulty","intent":"Informational"|"Commercial"|"Transactional","opportunity"}],
  "techSignals": string[],
  "pricingSignals": string[],
  "swot": {"strengths":string[],"weaknesses":string[],"opportunities":string[],"threats":string[]},
  "actions": [{"title","why","channel","effort":"S"|"M"|"L"}],
  "brand": {"voice":string,"tone":string[],"colors":{"primary","accent","ink"},"doSay":string[],"dontSay":string[]}
}
Keep competitors to 3, ads to 3, keywords to 4, actions to 3. No markdown.`;

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "You are a sharp B2B/B2C marketing strategist. Return strict JSON only.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!res.ok) return base;
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<Analysis>;
    return {
      ...base,
      ...parsed,
      domain: base.domain,
      brandName: base.brandName,
      industry: base.industry,
      analysedAt: new Date().toISOString(),
      source: "ai",
      competitors: parsed.competitors?.length ? parsed.competitors : base.competitors,
      ads: parsed.ads?.length ? parsed.ads : base.ads,
      keywords: parsed.keywords?.length ? parsed.keywords : base.keywords,
      techSignals: parsed.techSignals?.length ? parsed.techSignals : base.techSignals,
      pricingSignals: parsed.pricingSignals?.length ? parsed.pricingSignals : base.pricingSignals,
      swot: parsed.swot || base.swot,
      actions: parsed.actions?.length ? parsed.actions : base.actions,
      brand: parsed.brand || base.brand,
    };
  } catch {
    return base;
  }
}

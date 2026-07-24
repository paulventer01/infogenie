/**
 * Market analysis — the "Analyse Now" entry flow. Given a website or a sector
 * (and a region), infer the industry and map the competitive set: who else
 * plays in the exact same industry, how they are positioned, and what to do
 * about each of them.
 *
 * The structured competitor set here is mock-first evidence, exactly like the
 * integration hub adapters: deterministic (seeded by the input) and clearly
 * simulated until live providers are connected. The narrative battle plan is
 * produced by the governed runner — grounded, gated, audited — with this
 * module supplying the deterministic mock when no live model credential is
 * present.
 */

export interface AnalyseRequest {
  website?: string;
  sector?: string;
  region?: string;
}

export interface Competitor {
  name: string;
  domain: string;
  positioning: string;
  strengths: string[];
  weaknesses: string[];
  threat: "low" | "medium" | "high" | "critical";
  counterMove: string;
}

export interface MarketMap {
  subject: string;
  industry: string;
  region: string;
  competitors: Competitor[];
}

/** Industry pools: real, recognisable players per industry so the analysis
 * reads true. The subject itself is excluded from its own competitor set. */
const INDUSTRIES: Record<string, { label: string; match: RegExp; pool: Array<Omit<Competitor, "threat" | "counterMove">> }> = {
  ecommerce_platforms: {
    label: "E-commerce platforms",
    match: /shopify|bigcommerce|woocommerce|magento|e-?comm|online store|webshop|storefront/i,
    pool: [
      { name: "Shopify", domain: "shopify.com", positioning: "Default choice for SMB online stores; app-store moat and brand gravity.", strengths: ["Enormous partner/app ecosystem", "Fast merchant onboarding"], weaknesses: ["Transaction-fee resentment at scale", "Limited B2B depth"] },
      { name: "BigCommerce", domain: "bigcommerce.com", positioning: "Open SaaS pitch aimed at mid-market merchants outgrowing entry tools.", strengths: ["No platform transaction fees", "Strong headless/API story"], weaknesses: ["Smaller ecosystem", "Weaker consumer brand awareness"] },
      { name: "WooCommerce", domain: "woocommerce.com", positioning: "Owns the WordPress long tail — free core, pay for hosting and extensions.", strengths: ["Huge installed base", "Total customisation freedom"], weaknesses: ["Merchant carries maintenance burden", "Fragmented quality of extensions"] },
      { name: "Wix eCommerce", domain: "wix.com", positioning: "Design-led website builder pulling first-time sellers upmarket.", strengths: ["Lowest barrier to entry", "Aggressive ad spend"], weaknesses: ["Ceiling for serious merchants", "Perceived as hobbyist"] },
      { name: "Squarespace Commerce", domain: "squarespace.com", positioning: "Premium-design brand converting creators and boutiques into sellers.", strengths: ["Best-in-class templates", "Strong creator brand"], weaknesses: ["Thin commerce feature depth", "Limited payment flexibility"] },
      { name: "Salesforce Commerce Cloud", domain: "salesforce.com", positioning: "Enterprise commerce embedded in the wider Salesforce estate.", strengths: ["Enterprise trust and sales machine", "CRM-native data"], weaknesses: ["Cost and implementation weight", "Slow for SMB motion"] },
    ],
  },
  fintech_trading: {
    label: "Retail trading & investing platforms",
    match: /etoro|robinhood|trading|broker|invest|stocks|cfd|forex/i,
    pool: [
      { name: "eToro", domain: "etoro.com", positioning: "Social/copy-trading pioneer monetising community-led investing.", strengths: ["CopyTrader network effects", "Multi-asset breadth"], weaknesses: ["Spread pricing scrutiny", "Regulatory patchwork by region"] },
      { name: "Robinhood", domain: "robinhood.com", positioning: "Commission-free mobile-first trading for the US retail generation.", strengths: ["Brand with younger investors", "Slick mobile UX"], weaknesses: ["US-centric", "Trust deficits from past outages"] },
      { name: "Interactive Brokers", domain: "interactivebrokers.com", positioning: "Professional-grade execution and pricing for serious traders.", strengths: ["Institutional-quality tooling", "Global market access"], weaknesses: ["Intimidating UX for beginners", "Weak social features"] },
      { name: "Trading 212", domain: "trading212.com", positioning: "Zero-commission European challenger with fractional investing.", strengths: ["Simple onboarding", "Strong European growth"], weaknesses: ["Feature depth", "Support at scale"] },
      { name: "Plus500", domain: "plus500.com", positioning: "CFD-focused platform with heavy performance-marketing engine.", strengths: ["Efficient acquisition machine", "Listed-company credibility"], weaknesses: ["CFD-only perception", "Thin education layer"] },
      { name: "XTB", domain: "xtb.com", positioning: "Broker pairing CFDs with real equities and heavy content marketing.", strengths: ["Education-led funnel", "Multi-market licences"], weaknesses: ["Brand recognition outside Europe", "Product sprawl"] },
    ],
  },
  crm_martech: {
    label: "CRM & marketing platforms",
    match: /hubspot|salesforce crm|crm|marketing automation|martech|pipedrive|zoho/i,
    pool: [
      { name: "HubSpot", domain: "hubspot.com", positioning: "Inbound-marketing brand grown into a full SMB/mid-market CRM suite.", strengths: ["Content/SEO moat", "Free-tier land-and-expand"], weaknesses: ["Pricing cliffs between hubs", "Enterprise depth"] },
      { name: "Salesforce", domain: "salesforce.com", positioning: "The enterprise CRM incumbent with unmatched ecosystem lock-in.", strengths: ["Enterprise distribution", "AppExchange ecosystem"], weaknesses: ["Cost + admin overhead", "SMB experience"] },
      { name: "Zoho CRM", domain: "zoho.com", positioning: "Value-priced full-suite alternative for cost-conscious teams.", strengths: ["Price-to-breadth ratio", "Suite integration"], weaknesses: ["Design polish", "Brand prestige"] },
      { name: "Pipedrive", domain: "pipedrive.com", positioning: "Sales-pipeline-first CRM loved by small sales teams.", strengths: ["Focused, simple pipeline UX", "Fast time-to-value"], weaknesses: ["Marketing-side depth", "Ceiling at scale"] },
      { name: "ActiveCampaign", domain: "activecampaign.com", positioning: "Automation-heavy email/CRM hybrid for digital-first SMBs.", strengths: ["Automation depth for price", "Deliverability reputation"], weaknesses: ["UI complexity", "Reporting"] },
      { name: "monday CRM", domain: "monday.com", positioning: "Work-OS brand extending sideways into sales workflows.", strengths: ["Visual flexibility", "Cross-team expansion motion"], weaknesses: ["CRM-specific depth", "Sales-team credibility"] },
    ],
  },
  online_learning: {
    label: "Online learning platforms",
    match: /coursera|udemy|course|learning|edtech|e-?learn|mooc|skillshare/i,
    pool: [
      { name: "Coursera", domain: "coursera.org", positioning: "University-credentialed learning at consumer scale.", strengths: ["Institutional partnerships", "Degree/credential ladder"], weaknesses: ["Completion rates", "Content refresh speed"] },
      { name: "Udemy", domain: "udemy.com", positioning: "Marketplace of practitioner-made courses with aggressive pricing.", strengths: ["Catalogue breadth", "B2B (Udemy Business) motion"], weaknesses: ["Quality variance", "Discount-driven brand"] },
      { name: "edX", domain: "edx.org", positioning: "Academic MOOC heritage now monetised under 2U.", strengths: ["University brand halo", "Credential credibility"], weaknesses: ["Product velocity", "Consumer marketing"] },
      { name: "Skillshare", domain: "skillshare.com", positioning: "Subscription community for creative skills.", strengths: ["Creator community", "Subscription model"], weaknesses: ["Narrow vertical", "Churn exposure"] },
      { name: "LinkedIn Learning", domain: "linkedin.com", positioning: "Career-graph-native learning bundled into LinkedIn.", strengths: ["Distribution via LinkedIn", "Enterprise bundling"], weaknesses: ["Depth per course", "Standalone identity"] },
      { name: "Pluralsight", domain: "pluralsight.com", positioning: "Tech-skills platform for engineering organisations.", strengths: ["Skill assessments", "Enterprise contracts"], weaknesses: ["Consumer reach", "Price"] },
    ],
  },
  travel_booking: {
    label: "Travel booking platforms",
    match: /booking|expedia|travel|hotel|flight|airbnb|trip/i,
    pool: [
      { name: "Booking.com", domain: "booking.com", positioning: "Accommodation OTA with unmatched supply and performance-marketing scale.", strengths: ["Inventory depth", "Conversion-optimised funnel"], weaknesses: ["Brand loyalty", "Supplier relations"] },
      { name: "Expedia", domain: "expedia.com", positioning: "Full-trip OTA bundling flights, stays and packages.", strengths: ["Package economics", "Loyalty programme (One Key)"], weaknesses: ["Brand sprawl", "Mobile share"] },
      { name: "Airbnb", domain: "airbnb.com", positioning: "Alternative-stays category owner with direct-traffic moat.", strengths: ["Direct brand demand", "Unique supply"], weaknesses: ["Hotel coverage", "Service consistency"] },
      { name: "Agoda", domain: "agoda.com", positioning: "APAC-strong OTA competing on price and coverage.", strengths: ["Asia inventory", "Price aggression"], weaknesses: ["Western brand recognition", "Differentiation"] },
      { name: "Trip.com", domain: "trip.com", positioning: "China-anchored global OTA expanding westward.", strengths: ["Chinese outbound travel base", "Full-stack travel products"], weaknesses: ["Trust in Western markets", "Geopolitical exposure"] },
      { name: "Hopper", domain: "hopper.com", positioning: "Mobile-only fintech-flavoured travel app for price prediction.", strengths: ["Price-prediction hook", "Gen-Z mobile brand"], weaknesses: ["Inventory breadth", "Support reputation"] },
    ],
  },
  crypto_exchange: {
    label: "Crypto exchanges",
    match: /coinbase|binance|crypto|bitcoin|exchange|web3|blockchain/i,
    pool: [
      { name: "Coinbase", domain: "coinbase.com", positioning: "Regulated, listed on-ramp positioned as the trusted US exchange.", strengths: ["Regulatory positioning", "Brand trust"], weaknesses: ["Fee premium", "Product breadth vs offshore rivals"] },
      { name: "Binance", domain: "binance.com", positioning: "Global volume leader competing on breadth and fees.", strengths: ["Liquidity depth", "Product velocity"], weaknesses: ["Regulatory overhang", "Trust volatility"] },
      { name: "Kraken", domain: "kraken.com", positioning: "Security-first veteran exchange for serious holders.", strengths: ["Security track record", "Pro-trader features"], weaknesses: ["Mainstream marketing", "UX for beginners"] },
      { name: "Crypto.com", domain: "crypto.com", positioning: "Consumer-brand play — cards, sponsorships, retail reach.", strengths: ["Brand spend (sports/naming rights)", "Card product"], weaknesses: ["Depth for pros", "Fee transparency"] },
      { name: "Gemini", domain: "gemini.com", positioning: "Compliance-led exchange targeting cautious capital.", strengths: ["Regulatory posture", "Custody products"], weaknesses: ["Volume/liquidity", "Growth momentum"] },
      { name: "OKX", domain: "okx.com", positioning: "Derivatives-strong global exchange courting advanced traders.", strengths: ["Derivatives depth", "Web3 wallet play"], weaknesses: ["Western trust", "Brand recognition"] },
    ],
  },
};

/** Generic pool when no named industry matches — synthesised but plausible
 * players parameterised by the sector text, still clearly simulated. */
function genericPool(sector: string): Array<Omit<Competitor, "threat" | "counterMove">> {
  const s = sector.trim() || "your market";
  const cap = s.charAt(0).toUpperCase() + s.slice(1);
  return [
    { name: `${cap} Leader Co`, domain: "marketleader.example", positioning: `Category incumbent in ${s} defending share with brand and distribution.`, strengths: ["Brand recognition", "Distribution reach"], weaknesses: ["Slow product cycles", "Legacy pricing"] },
    { name: `${cap} Challenger`, domain: "challenger.example", positioning: `Fast-growing challenger undercutting incumbents in ${s} on price.`, strengths: ["Price aggression", "Modern product"], weaknesses: ["Thin margins", "Small team"] },
    { name: `${cap} Boutique`, domain: "boutique.example", positioning: `Premium specialist serving the high end of ${s}.`, strengths: ["Service depth", "Premium brand"], weaknesses: ["Scale limits", "High cost base"] },
    { name: `${cap} Platform`, domain: "platform.example", positioning: `Platform play aggregating supply and demand across ${s}.`, strengths: ["Network effects", "Data advantage"], weaknesses: ["Cold-start dependence", "Take-rate pressure"] },
    { name: `${cap} Local`, domain: "local.example", positioning: `Regional operator with strong local relationships in ${s}.`, strengths: ["Local trust", "Regulatory familiarity"], weaknesses: ["Geographic ceiling", "Capital access"] },
  ];
}

/** Deterministic PRNG so the same input always maps the same market. */
function seeded(seedStr: string): () => number {
  let h = 2166136261;
  for (const ch of seedStr) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
    return ((h >>> 0) % 10000) / 10000;
  };
}

function normaliseDomain(website: string): string {
  return website.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? "";
}

export function analyseMarket(req: AnalyseRequest): MarketMap {
  const domain = req.website ? normaliseDomain(req.website) : "";
  const subject = domain || (req.sector?.trim() || "your business");
  const region = req.region?.trim() || "Global";
  const probe = `${domain} ${req.sector ?? ""}`;

  let industryKey: string | null = null;
  for (const [key, ind] of Object.entries(INDUSTRIES)) {
    if (ind.match.test(probe)) { industryKey = key; break; }
  }
  const industry = industryKey ? INDUSTRIES[industryKey]!.label : (req.sector?.trim() || "General market");
  const basePool = industryKey ? INDUSTRIES[industryKey]!.pool : genericPool(req.sector ?? subject);

  // Exact-same-industry set, excluding the subject itself.
  const pool = basePool.filter((c) => c.domain !== domain);
  const rand = seeded(`${subject}|${region}`);
  const threats: Competitor["threat"][] = ["medium", "high", "critical", "low"];
  const competitors: Competitor[] = pool.slice(0, 5).map((c) => {
    const threat = threats[Math.floor(rand() * threats.length)]!;
    return {
      ...c,
      threat,
      counterMove:
        threat === "critical" || threat === "high"
          ? `Neutralise ${c.name}'s "${c.strengths[0]?.toLowerCase()}" advantage: target their "${c.weaknesses[0]?.toLowerCase()}" weakness in comparative positioning and win their at-risk segment in ${region}.`
          : `Monitor ${c.name} quarterly; exploit their "${c.weaknesses[0]?.toLowerCase()}" gap with focused content and offers in ${region}.`,
    };
  });

  return { subject, industry, region, competitors };
}

/** Narrative battle plan used as the governed run's deterministic mock output. */
export function battlePlanText(map: MarketMap): string {
  const lines = [
    `Market map for ${map.subject} — ${map.industry}, ${map.region} (simulated evidence until live providers are connected).`,
    "",
    ...map.competitors.map(
      (c, i) =>
        `${i + 1}. ${c.name} (${c.domain}) — threat: ${c.threat}.\n   Positioning: ${c.positioning}\n   Strengths: ${c.strengths.join("; ")}. Weaknesses: ${c.weaknesses.join("; ")}.\n   Counter-move: ${c.counterMove}`,
    ),
    "",
    `Battle plan: prioritise the ${map.competitors.filter((c) => c.threat === "critical" || c.threat === "high").length} high/critical threats first; re-run after connecting live integrations for evidence-backed analysis.`,
  ];
  return lines.join("\n");
}

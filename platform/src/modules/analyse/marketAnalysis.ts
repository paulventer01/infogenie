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
 * reads true. The subject itself is excluded from its own competitor set.
 * `match` catches explicit names/phrases; `keywords` are distinctive fragments
 * matched inside the domain name itself (e.g. "plumb" in joesplumbing.co.za),
 * so an arbitrary website still lands in its real industry. */
const INDUSTRIES: Record<string, { label: string; match: RegExp; keywords?: string[]; pool: Array<Omit<Competitor, "threat" | "counterMove">> }> = {
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
    keywords: ["trade", "trading", "forex", "invest", "broker", "stock", "wealth", "capital"],
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
  martech_agentic: {
    label: "AI marketing & measurement platforms",
    match: /bluealpha|infogenie|triple ?whale|northbeam|martech|marketing (platform|intelligence|analytics|ai)|agentic marketing|incrementality|mmm|marketing mix/i,
    pool: [
      { name: "BlueAlpha", domain: "bluealpha.ai", positioning: "Ex-Tesla team running paid media 'like a portfolio': Meridian-based causal MMM refit weekly, seven agents, execution shipped to ad accounts with a human in the loop.", strengths: ["Causal measurement depth (incrementality, not reported ROAS)", "Closed analyse→act loop with on-platform execution"], weaknesses: ["Narrow scope: paid-media budget only, not the full marketing estate", "High-touch positioning limits self-serve reach"] },
      { name: "Triple Whale", domain: "triplewhale.com", positioning: "E-commerce analytics hub unifying ad platform and store data for DTC brands.", strengths: ["Strong DTC brand and community", "Fast time-to-dashboard"], weaknesses: ["Correlation-heavy attribution", "Shopify-centric ceiling"] },
      { name: "Northbeam", domain: "northbeam.io", positioning: "Multi-touch attribution and MMM for performance marketers at scale.", strengths: ["Attribution modelling credibility", "Enterprise media buyers"], weaknesses: ["Analyst-heavy onboarding", "Insight without execution"] },
      { name: "Smartly", domain: "smartly.io", positioning: "Creative + media automation across social ad platforms for enterprises.", strengths: ["Creative automation at scale", "Deep platform partnerships"], weaknesses: ["Social-first scope", "Enterprise price point"] },
      { name: "Madgicx", domain: "madgicx.com", positioning: "AI ad-management copilot for Meta-centric SMB advertisers.", strengths: ["Low entry price", "Meta optimisation depth"], weaknesses: ["Single-channel gravity", "Shallow measurement layer"] },
      { name: "Optmyzr", domain: "optmyzr.com", positioning: "Rule-and-script PPC optimisation suite for search marketers.", strengths: ["Practitioner loyalty in PPC", "Granular control"], weaknesses: ["Pre-agentic paradigm (rules, not reasoning)", "Limited cross-channel view"] },
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
  retail: {
    label: "Retail & e-commerce",
    match: /\bretail(er)?\b|e-?commerce store|online (shop|store)|department store/i,
    keywords: ["shop", "store", "retail", "market", "mall", "boutique", "deals"],
    pool: [
      { name: "Amazon", domain: "amazon.com", positioning: "Everything-store incumbent with logistics and Prime lock-in.", strengths: ["Fulfilment network", "Price + selection breadth"], weaknesses: ["Commoditised experience", "Marketplace trust erosion"] },
      { name: "Walmart", domain: "walmart.com", positioning: "Omnichannel giant pairing stores with fast-growing online reach.", strengths: ["Store-network pickup economics", "Grocery frequency"], weaknesses: ["Brand ceiling upmarket", "Third-party marketplace depth"] },
      { name: "Takealot", domain: "takealot.com", positioning: "South Africa's dominant online retailer with own logistics.", strengths: ["Local delivery network", "Local brand trust"], weaknesses: ["Thin margins", "Amazon's SA entry pressure"] },
      { name: "Temu", domain: "temu.com", positioning: "Ultra-low-price cross-border marketplace growing on ad spend.", strengths: ["Price aggression", "Massive acquisition budget"], weaknesses: ["Delivery times", "Quality perception"] },
      { name: "Shein", domain: "shein.com", positioning: "Fast-supply-chain retail with social-first demand generation.", strengths: ["Speed to trend", "Social commerce engine"], weaknesses: ["Sustainability scrutiny", "Quality variance"] },
    ],
  },
  food_hospitality: {
    label: "Food delivery & hospitality",
    match: /restaurant|food delivery|takeaway|catering|coffee shop|cafe|bakery/i,
    keywords: ["food", "eat", "pizza", "burger", "grill", "kitchen", "cafe", "coffee", "bakery", "catering", "restaurant"],
    pool: [
      { name: "Uber Eats", domain: "ubereats.com", positioning: "Global delivery marketplace riding the Uber network.", strengths: ["Rider network density", "App distribution"], weaknesses: ["Take-rate resentment", "Loyalty is to the app, not restaurants"] },
      { name: "Mr D", domain: "mrdfood.com", positioning: "Takealot-group delivery player with deep South African coverage.", strengths: ["Local coverage", "Group synergies"], weaknesses: ["Regional only", "Marketing scale vs global players"] },
      { name: "DoorDash", domain: "doordash.com", positioning: "US delivery leader expanding into commerce logistics.", strengths: ["US market share", "Logistics platform play"], weaknesses: ["International reach", "Unit economics"] },
      { name: "Deliveroo", domain: "deliveroo.com", positioning: "Premium-leaning delivery brand in UK/EU metros.", strengths: ["Restaurant relationships", "Dense-metro economics"], weaknesses: ["Coverage outside metros", "Profitability pressure"] },
      { name: "Just Eat Takeaway", domain: "justeattakeaway.com", positioning: "Consolidated European marketplace of national brands.", strengths: ["Market-leader positions in EU", "Order volume"], weaknesses: ["Brand fragmentation", "Tech debt from mergers"] },
    ],
  },
  real_estate: {
    label: "Real estate & property",
    match: /real estate|property|estate agen|realtor|lettings?\b/i,
    keywords: ["property", "realty", "estate", "homes", "immo", "rentals"],
    pool: [
      { name: "Property24", domain: "property24.com", positioning: "South Africa's leading property portal — the default search start.", strengths: ["Listing liquidity", "Agent network"], weaknesses: ["Portal model disruption risk", "Consumer experience parity"] },
      { name: "Zillow", domain: "zillow.com", positioning: "US property search giant monetising agent leads and data.", strengths: ["Consumer traffic moat", "Zestimate data brand"], weaknesses: ["Agent dependence", "iBuying scars"] },
      { name: "Rightmove", domain: "rightmove.co.uk", positioning: "UK portal incumbent with pricing power over agents.", strengths: ["Near-monopoly UK traffic", "High-margin model"], weaknesses: ["Agent fee resentment", "Innovation pace"] },
      { name: "Private Property", domain: "privateproperty.co.za", positioning: "SA challenger portal competing on agent economics.", strengths: ["Agent-friendly pricing", "Local focus"], weaknesses: ["Traffic gap to leader", "Brand spend"] },
      { name: "Redfin", domain: "redfin.com", positioning: "Tech-led brokerage undercutting commissions with salaried agents.", strengths: ["Integrated brokerage model", "Fee disruption story"], weaknesses: ["Market-cycle exposure", "Coverage"] },
    ],
  },
  insurance: {
    label: "Insurance",
    match: /insur(ance|er)|underwrit|assurance|broker(age)? cover/i,
    keywords: ["insur", "sure", "cover", "assur", "protect"],
    pool: [
      { name: "OUTsurance", domain: "outsurance.co.za", positioning: "Direct insurer with the 'you always get something out' brand promise.", strengths: ["Direct model economics", "Brand recall"], weaknesses: ["Price-comparison pressure", "Younger-market appeal"] },
      { name: "Santam", domain: "santam.co.za", positioning: "South Africa's largest short-term insurer, broker-led.", strengths: ["Underwriting scale", "Broker network"], weaknesses: ["Direct-channel agility", "Legacy systems"] },
      { name: "Lemonade", domain: "lemonade.com", positioning: "AI-native insurer selling speed and transparency to digital natives.", strengths: ["Onboarding UX", "AI claims speed"], weaknesses: ["Loss-ratio pressure", "Product breadth"] },
      { name: "Discovery Insure", domain: "discovery.co.za", positioning: "Behaviour-linked insurance riding the Vitality ecosystem.", strengths: ["Behavioural data moat", "Cross-sell ecosystem"], weaknesses: ["Complexity", "Premium positioning"] },
      { name: "Naked", domain: "naked.insure", positioning: "App-only SA challenger with instant cover and AI claims.", strengths: ["Digital-first cost base", "Transparent pricing"], weaknesses: ["Scale", "Single-market exposure"] },
    ],
  },
  banking_fintech: {
    label: "Banking & payments",
    match: /\bbank(ing)?\b|payments? (platform|provider)|neobank|digital wallet/i,
    keywords: ["bank", "pay", "wallet", "money", "lend", "credit", "finance"],
    pool: [
      { name: "Capitec", domain: "capitecbank.co.za", positioning: "Low-fee simplicity that took SA retail banking by storm.", strengths: ["Cost leadership", "Client growth engine"], weaknesses: ["Premium segment", "Business banking depth"] },
      { name: "Revolut", domain: "revolut.com", positioning: "Global neobank super-app spanning cards, FX, and trading.", strengths: ["Feature velocity", "Multi-market scale"], weaknesses: ["Support at scale", "Regulatory friction"] },
      { name: "TymeBank", domain: "tymebank.co.za", positioning: "SA digital bank acquiring through retail partnerships.", strengths: ["Kiosk onboarding via retailers", "Low cost base"], weaknesses: ["Deposit franchise depth", "Brand trust vs incumbents"] },
      { name: "Wise", domain: "wise.com", positioning: "Cross-border money movement at transparent mid-market rates.", strengths: ["FX price leadership", "Infrastructure licensing"], weaknesses: ["Single-product gravity", "Bank partnerships"] },
      { name: "Stripe", domain: "stripe.com", positioning: "Developer-first payments infrastructure for the internet economy.", strengths: ["Developer mindshare", "Product surface breadth"], weaknesses: ["Enterprise pricing pushback", "Support complexity"] },
    ],
  },
  healthcare: {
    label: "Healthcare & wellness",
    match: /health(care)?|medical|clinic|telehealth|pharma|dental|wellness/i,
    keywords: ["health", "med", "clinic", "care", "pharm", "dental", "doctor"],
    pool: [
      { name: "Discovery Health", domain: "discovery.co.za", positioning: "SA's dominant medical scheme with the Vitality behaviour engine.", strengths: ["Scheme scale", "Behavioural ecosystem"], weaknesses: ["Affordability perception", "Complexity"] },
      { name: "Teladoc Health", domain: "teladochealth.com", positioning: "Telehealth pioneer serving employers and health plans.", strengths: ["Enterprise contracts", "Clinical breadth"], weaknesses: ["Consumer brand", "Growth after the telehealth wave"] },
      { name: "Hello Doctor", domain: "hellodoctor.co.za", positioning: "Mobile-first SA telehealth at mass-market price points.", strengths: ["Accessibility", "Corporate/insurer channels"], weaknesses: ["Monetisation depth", "Clinical scope"] },
      { name: "Zocdoc", domain: "zocdoc.com", positioning: "Appointment marketplace owning the find-a-doctor moment.", strengths: ["Booking intent capture", "Provider network"], weaknesses: ["US-only", "Payer integration"] },
      { name: "Netcare", domain: "netcare.co.za", positioning: "Private hospital group extending into digital care.", strengths: ["Facility network", "Clinical reputation"], weaknesses: ["Asset-heavy model", "Digital pace"] },
    ],
  },
  fitness: {
    label: "Fitness & gyms",
    match: /\bgym\b|fitness|workout|personal train|pilates|yoga studio|crossfit/i,
    keywords: ["gym", "fit", "fitness", "train", "yoga", "pilates", "wellness"],
    pool: [
      { name: "Virgin Active", domain: "virginactive.co.za", positioning: "Premium club network anchoring the SA fitness market.", strengths: ["Club footprint", "Brand aspiration"], weaknesses: ["Price point", "Home-fitness substitution"] },
      { name: "Planet Fitness", domain: "planetfitness.co.za", positioning: "Value-priced clubs with a judgement-free mass appeal.", strengths: ["Accessible pricing", "Franchise growth engine"], weaknesses: ["Premium amenities", "Member churn"] },
      { name: "Peloton", domain: "onepeloton.com", positioning: "Connected home fitness with subscription content.", strengths: ["Content + community lock-in", "Brand devotion"], weaknesses: ["Hardware cycle exposure", "Post-pandemic demand"] },
      { name: "ClassPass", domain: "classpass.com", positioning: "Aggregator selling flexibility across studios.", strengths: ["Variety proposition", "Studio fill-rate economics"], weaknesses: ["Studio margin tension", "Loyalty to platform not studios"] },
      { name: "F45 Training", domain: "f45training.com", positioning: "Franchised functional-training studios with global playbook.", strengths: ["Format consistency", "Community workout culture"], weaknesses: ["Franchisee economics", "Fad-cycle risk"] },
    ],
  },
  legal: {
    label: "Legal services",
    match: /\blaw firm\b|legal (services|tech)|attorney|conveyanc|litigation/i,
    keywords: ["law", "legal", "attorney", "advocate", "counsel"],
    pool: [
      { name: "LegalZoom", domain: "legalzoom.com", positioning: "Self-serve legal documents and filings at consumer scale.", strengths: ["Brand for DIY legal", "Volume economics"], weaknesses: ["Advice-depth ceiling", "Commoditisation"] },
      { name: "Rocket Lawyer", domain: "rocketlawyer.com", positioning: "Subscription legal help blending documents with on-call attorneys.", strengths: ["Subscription model", "SMB focus"], weaknesses: ["Differentiation vs free templates", "Churn"] },
      { name: "Clio", domain: "clio.com", positioning: "Practice-management platform the modern law firm runs on.", strengths: ["Law-firm workflow lock-in", "App ecosystem"], weaknesses: ["Serves firms, not clients", "Enterprise legal ops"] },
      { name: "LawForMe", domain: "lawforme.co.za", positioning: "SA online legal documents and fixed-fee services.", strengths: ["Fixed-fee transparency", "Local law coverage"], weaknesses: ["Scale", "Brand awareness"] },
      { name: "Legal & General practices", domain: "locallawfirms.example", positioning: "Traditional local firms competing on relationships and reputation.", strengths: ["Trust and referrals", "Full-service depth"], weaknesses: ["Pricing opacity", "Digital client experience"] },
    ],
  },
  accounting: {
    label: "Accounting & tax software",
    match: /account(ing|ant)|bookkeep|tax (software|services|filing)|payroll/i,
    keywords: ["account", "tax", "bookkeep", "payroll", "audit", "ledger"],
    pool: [
      { name: "Xero", domain: "xero.com", positioning: "Cloud accounting loved by small businesses and their advisors.", strengths: ["Advisor channel", "App ecosystem"], weaknesses: ["US share vs Intuit", "Price rises testing loyalty"] },
      { name: "QuickBooks (Intuit)", domain: "quickbooks.intuit.com", positioning: "SMB accounting incumbent with the largest US base.", strengths: ["Distribution + brand", "AI feature investment"], weaknesses: ["Complex pricing", "International depth"] },
      { name: "Sage", domain: "sage.com", positioning: "Legacy leader migrating a large installed base to cloud.", strengths: ["Installed base + partner network", "Compliance depth (incl. SA payroll)"], weaknesses: ["Cloud UX gap", "Innovation speed"] },
      { name: "FreshBooks", domain: "freshbooks.com", positioning: "Invoicing-first accounting for freelancers and micro-businesses.", strengths: ["Simplicity", "Time+billing fit for services"], weaknesses: ["Accountant ecosystem", "Feature ceiling"] },
      { name: "Zoho Books", domain: "zoho.com", positioning: "Value accounting inside the wider Zoho suite.", strengths: ["Suite bundling", "Price"], weaknesses: ["Advisor mindshare", "Brand prestige"] },
    ],
  },
  logistics: {
    label: "Logistics & courier",
    match: /courier|logistics|freight|shipping|last[- ]mile|parcel/i,
    keywords: ["courier", "logistics", "cargo", "freight", "ship", "express", "deliver"],
    pool: [
      { name: "The Courier Guy", domain: "thecourierguy.co.za", positioning: "SA's e-commerce courier of choice with kiosk/locker reach.", strengths: ["E-commerce integrations", "National coverage + lockers"], weaknesses: ["Peak-season strain", "Cross-border depth"] },
      { name: "DHL", domain: "dhl.com", positioning: "Global express leader with premium cross-border trust.", strengths: ["Global network", "Customs expertise"], weaknesses: ["Price premium", "Domestic last-mile cost"] },
      { name: "FedEx", domain: "fedex.com", positioning: "Express and freight scale player restructuring for efficiency.", strengths: ["Network scale", "B2B relationships"], weaknesses: ["Cost structure", "E-commerce economics"] },
      { name: "Aramex", domain: "aramex.com", positioning: "Emerging-markets logistics with strong Middle East/Africa lanes.", strengths: ["Emerging-market lanes", "Franchise flexibility"], weaknesses: ["Brand vs global majors", "Service consistency"] },
      { name: "uAfrica/Bob Go", domain: "bobgo.co.za", positioning: "SA shipping-aggregation layer plugged into online stores.", strengths: ["Multi-courier rates in one API", "Merchant tooling"], weaknesses: ["Depends on carrier partners", "Thin aggregation margins"] },
    ],
  },
  home_services: {
    label: "Home services & trades",
    match: /plumb|electrician|handyman|renovat|home services|builder|roofing|hvac|solar install/i,
    keywords: ["plumb", "electric", "build", "renov", "repair", "clean", "pest", "garden", "roof", "paint", "solar", "handyman", "maintenance"],
    pool: [
      { name: "Kandua", domain: "kandua.com", positioning: "SA marketplace connecting vetted home pros with homeowners.", strengths: ["Vetting + reviews trust", "Local SEO strength"], weaknesses: ["Job liquidity outside metros", "Pro retention"] },
      { name: "Angi", domain: "angi.com", positioning: "US home-services marketplace with massive demand capture.", strengths: ["Demand volume", "Brand history"], weaknesses: ["Lead-quality complaints", "Pro economics"] },
      { name: "Thumbtack", domain: "thumbtack.com", positioning: "Project-based matching across hundreds of service categories.", strengths: ["Category breadth", "Instant matching"], weaknesses: ["Pay-per-lead resentment", "Retention"] },
      { name: "TaskRabbit", domain: "taskrabbit.com", positioning: "IKEA-owned odd-jobs network for same-day tasks.", strengths: ["IKEA distribution", "Same-day convenience"], weaknesses: ["Skilled-trade depth", "Coverage"] },
      { name: "Local established trades", domain: "localtrades.example", positioning: "Independent operators winning on word of mouth and speed to site.", strengths: ["Relationships + referrals", "Price flexibility"], weaknesses: ["No digital presence", "Capacity limits"] },
    ],
  },
  cybersecurity: {
    label: "Cybersecurity",
    match: /cyber ?security|infosec|endpoint (security|protection)|threat detection|penetration test/i,
    keywords: ["secur", "cyber", "shield", "defend", "threat"],
    pool: [
      { name: "CrowdStrike", domain: "crowdstrike.com", positioning: "Cloud-native endpoint security platform with elite brand.", strengths: ["Platform consolidation story", "Threat-intel brand"], weaknesses: ["Premium pricing", "Outage trust scar"] },
      { name: "Palo Alto Networks", domain: "paloaltonetworks.com", positioning: "Broadest security platform via aggressive M&A.", strengths: ["Portfolio breadth", "Enterprise relationships"], weaknesses: ["Integration complexity", "Platformisation fatigue"] },
      { name: "SentinelOne", domain: "sentinelone.com", positioning: "AI-first endpoint challenger competing on autonomy.", strengths: ["Autonomous response tech", "Price/performance"], weaknesses: ["Scale vs leaders", "Profitability"] },
      { name: "Fortinet", domain: "fortinet.com", positioning: "Network-security value leader with custom silicon.", strengths: ["Price/performance via ASICs", "SMB-to-enterprise reach"], weaknesses: ["Cloud-native perception", "Vulnerability headlines"] },
      { name: "Wiz", domain: "wiz.io", positioning: "Cloud-security rocket ship with land-fast agentless scanning.", strengths: ["Deployment speed", "Sales momentum"], weaknesses: ["Runtime depth", "Price at renewal"] },
    ],
  },
  recruitment: {
    label: "Recruitment & HR",
    match: /recruit|staffing|talent acquisition|job board|\bhr\b|human resources/i,
    keywords: ["recruit", "talent", "staff", "jobs", "career", "hire"],
    pool: [
      { name: "Pnet", domain: "pnet.co.za", positioning: "SA's leading job platform (Stepstone group).", strengths: ["Candidate database depth", "Employer brand reach"], weaknesses: ["LinkedIn encroachment", "Product innovation pace"] },
      { name: "LinkedIn Talent", domain: "linkedin.com", positioning: "The professional graph monetised for recruiting.", strengths: ["Network moat", "Passive-candidate reach"], weaknesses: ["Cost", "Recruiter InMail fatigue"] },
      { name: "Careers24", domain: "careers24.com", positioning: "Media24-backed SA job board with consumer reach.", strengths: ["Media distribution", "Local brand"], weaknesses: ["Differentiation", "Tech investment"] },
      { name: "Greenhouse", domain: "greenhouse.com", positioning: "Structured-hiring ATS for scaling companies.", strengths: ["Hiring-process discipline", "Integration ecosystem"], weaknesses: ["Serves employers only", "SMB price fit"] },
      { name: "Indeed", domain: "indeed.com", positioning: "Volume job aggregator with pay-per-application model.", strengths: ["Traffic scale", "Simplicity"], weaknesses: ["Quality vs volume", "Employer cost creep"] },
    ],
  },
  saas_b2b: {
    label: "B2B SaaS",
    match: /\bsaas\b|b2b software|software platform|productivity software|workflow tool/i,
    keywords: ["app", "cloud", "soft", "tech", "digital", "systems"],
    pool: [
      { name: "Salesforce", domain: "salesforce.com", positioning: "The enterprise SaaS incumbent and ecosystem gravity well.", strengths: ["Distribution machine", "Ecosystem lock-in"], weaknesses: ["Cost + complexity", "Innovation surface area"] },
      { name: "Microsoft 365", domain: "microsoft.com", positioning: "Bundled productivity default for the enterprise.", strengths: ["Bundle economics", "IT relationships"], weaknesses: ["Best-of-breed gaps", "SMB attention"] },
      { name: "Atlassian", domain: "atlassian.com", positioning: "Bottom-up tools for software and knowledge teams.", strengths: ["Product-led motion", "Developer loyalty"], weaknesses: ["Enterprise sales muscle", "Suite coherence"] },
      { name: "Zoho", domain: "zoho.com", positioning: "50-app value suite for cost-conscious businesses.", strengths: ["Price-to-breadth", "Private ownership patience"], weaknesses: ["Depth per app", "Brand prestige"] },
      { name: "monday.com", domain: "monday.com", positioning: "Flexible work-OS expanding from projects into CRM and dev.", strengths: ["Visual flexibility", "Marketing engine"], weaknesses: ["Depth vs specialists", "Seat-price sensitivity"] },
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

/** The registrable name part of a domain: "www.joesplumbing.co.za" → "joesplumbing". */
function domainBase(domain: string): string {
  const parts = domain.split(".").filter(Boolean);
  if (parts.length === 0) return "";
  // Trailing TLD / country labels are short; the business name is the longest-left label.
  const tldish = new Set(["com", "co", "org", "net", "io", "ai", "app", "biz", "info", "shop", "online", "site", "za", "uk", "us", "au", "de", "nl", "fr", "es", "it", "in", "ng", "ke", "bw", "na", "mu", "zw"]);
  const nameParts = parts.filter((p) => !tldish.has(p));
  return (nameParts[nameParts.length - 1] ?? parts[0]!).toLowerCase();
}

export function analyseMarket(req: AnalyseRequest): MarketMap {
  const domain = req.website ? normaliseDomain(req.website) : "";
  const subject = domain || (req.sector?.trim() || "your business");
  const region = req.region?.trim() || "Global";
  const probe = `${domain} ${req.sector ?? ""}`;
  const base = domainBase(domain);
  const sectorText = (req.sector ?? "").toLowerCase();

  // Match order: explicit name/phrase regex first, then distinctive keyword
  // fragments inside the domain name itself or the sector text — so an
  // arbitrary business site still lands in its real industry.
  let industryKey: string | null = null;
  for (const [key, ind] of Object.entries(INDUSTRIES)) {
    if (ind.match.test(probe)) { industryKey = key; break; }
  }
  if (!industryKey && (base || sectorText)) {
    for (const [key, ind] of Object.entries(INDUSTRIES)) {
      if (ind.keywords?.some((k) => (base.length > 0 && base.includes(k)) || (sectorText.length > 0 && sectorText.includes(k)))) {
        industryKey = key;
        break;
      }
    }
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

/**
 * Identify the market through the LLM gateway. With a live model credential
 * the model names the subject's real industry and its actual closest
 * competitors — for any website, not just the built-in taxonomy; without one,
 * the deterministic mapper answers (the gateway's mock path), so behaviour is
 * identical offline. Either way the call is metered, screened, and the result
 * validated before use — a malformed model reply falls back to the mapper.
 */
export async function identifyMarket(tenantId: string, req: AnalyseRequest): Promise<MarketMap> {
  const fallback = analyseMarket(req);
  const { withTenant } = await import("../../db/tenantContext.js");
  const { gatewayCall } = await import("../../gateway/llmGateway.js");
  try {
    const raw = await withTenant(tenantId, (client) =>
      gatewayCall(client, {
        capabilityKey: "compete.market_analysis",
        purpose: "market identification",
        modelClass: "frontier",
        system:
          "You are the Market Analysis capability of a marketing intelligence platform. " +
          "Given a subject (a website domain and/or a sector) and a region, identify the subject's exact industry and its 5 most direct competitors IN THAT SAME INDUSTRY. " +
          "Use real, well-known companies competing in the subject's market and region; never include the subject itself. " +
          "Respond with ONLY valid JSON, no prose, matching exactly: " +
          '{"industry": string, "competitors": [{"name": string, "domain": string, "positioning": string, "strengths": [string, string], "weaknesses": [string, string], "threat": "low"|"medium"|"high"|"critical", "counterMove": string}]}',
        prompt: "Identify the market for the subject below.",
        untrustedInput: `subject website: ${req.website ?? "(none)"}; sector: ${req.sector ?? "(none)"}; region: ${req.region ?? "Global"}`,
        mock: () => JSON.stringify({ industry: fallback.industry, competitors: fallback.competitors }),
      }),
    );
    const parsed = JSON.parse(raw.text.replace(/^```(json)?|```$/gm, "").trim()) as {
      industry?: unknown; competitors?: unknown;
    };
    const threats = new Set(["low", "medium", "high", "critical"]);
    const competitors = (Array.isArray(parsed.competitors) ? parsed.competitors : [])
      .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
      .map((c) => ({
        name: String(c.name ?? "").trim(),
        domain: String(c.domain ?? "").trim().toLowerCase(),
        positioning: String(c.positioning ?? "").trim(),
        strengths: (Array.isArray(c.strengths) ? c.strengths : []).map(String).filter(Boolean).slice(0, 3),
        weaknesses: (Array.isArray(c.weaknesses) ? c.weaknesses : []).map(String).filter(Boolean).slice(0, 3),
        threat: (threats.has(String(c.threat)) ? String(c.threat) : "medium") as Competitor["threat"],
        counterMove: String(c.counterMove ?? "").trim(),
      }))
      .filter((c) => c.name && c.positioning && c.domain !== normaliseDomain(req.website ?? ""))
      .slice(0, 6);
    if (typeof parsed.industry !== "string" || !parsed.industry.trim() || competitors.length < 3) return fallback;
    return { subject: fallback.subject, industry: parsed.industry.trim(), region: fallback.region, competitors };
  } catch {
    return fallback;
  }
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

// ============================================================
// InfoGenie — Industry Intelligence Database
// ============================================================

const INDUSTRY_DB = {
  ecommerce: {
    name: 'E-commerce & Retail',
    keywords: ['shop','store','buy','cart','checkout','product','sale','retail','merch','fashion','clothing','apparel','shoes','jewelry','furniture','home','decor','beauty','cosmetics','skincare','amazon','ebay','etsy','shopify','woo','magento','bigcommerce','commerce','market','goods'],
    competitors: [
      {
        name: 'Amazon', url: 'amazon.com', logo: 'A',
        traffic: '2.4B', ctr: '4.8%', roas: 6.2, adSpend: '$2.1B/mo',
        topChannel: 'Google Shopping', threatLevel: 'high',
        campaigns: [
          { name: 'Prime Day 2024', channel: 'Google', ctr: '5.2%', roas: 7.1, budget: '$180M', status: 'Active' },
          { name: 'Fashion Summer Sale', channel: 'Meta', ctr: '3.8%', roas: 5.4, budget: '$42M', status: 'Active' },
          { name: 'Electronics Deals', channel: 'YouTube', ctr: '2.9%', roas: 4.8, budget: '$28M', status: 'Paused' }
        ],
        suggestions: [
          'Target price-sensitive segments with dynamic pricing ads — Amazon rarely discounts aggressively in off-peak periods',
          'Exploit Amazon\'s weak personalisation in search ads with hyper-targeted long-tail keywords',
          'Focus on brand loyalty messaging — Amazon scores low on brand affinity vs. specialist retailers',
          'Use video UGC content to compete in TikTok where Amazon has minimal presence'
        ],
        audiences: [{ label: '25–34 Female Shoppers', pct: 38 }, { label: '35–44 Male Tech', pct: 24 }, { label: '18–24 Fashion', pct: 22 }, { label: '45+ Home Goods', pct: 16 }],
        topKeywords: ['buy online', 'free shipping', 'best deals', 'product reviews'],
        estimatedROI: '+28% CTR improvement possible targeting underserved niches'
      },
      {
        name: 'Shopify', url: 'shopify.com', logo: 'S',
        traffic: '148M', ctr: '3.2%', roas: 4.8, adSpend: '$42M/mo',
        topChannel: 'Google Search', threatLevel: 'high',
        campaigns: [
          { name: 'Build Your Store', channel: 'Google', ctr: '3.8%', roas: 5.2, budget: '$12M', status: 'Active' },
          { name: 'Free Trial Push', channel: 'Meta', ctr: '2.9%', roas: 4.1, budget: '$8M', status: 'Active' },
          { name: 'Entrepreneur Stories', channel: 'TikTok', ctr: '4.1%', roas: 3.8, budget: '$6M', status: 'Active' }
        ],
        suggestions: [
          'Outperform with faster onboarding messaging — Shopify\'s 14-day trial creates friction',
          'Target WooCommerce and Magento migration keywords where Shopify spend is minimal',
          'Lead with AI-powered features — Shopify\'s AI messaging is generic and unspecific',
          'Use success story creatives showing revenue milestones — converts 2.3× better than feature ads'
        ],
        audiences: [{ label: 'SMB Owners 30–45', pct: 41 }, { label: 'Side Hustle 22–30', pct: 29 }, { label: 'Agency Owners', pct: 18 }, { label: 'Enterprise Retail', pct: 12 }],
        topKeywords: ['ecommerce platform', 'online store builder', 'sell online', 'dropshipping'],
        estimatedROI: '+35% ROAS improvement via platform migration targeting'
      },
      {
        name: 'eBay', url: 'ebay.com', logo: 'e',
        traffic: '820M', ctr: '2.9%', roas: 3.9, adSpend: '$320M/mo',
        topChannel: 'Google Shopping', threatLevel: 'medium',
        campaigns: [
          { name: 'Daily Deals', channel: 'Google', ctr: '3.1%', roas: 4.2, budget: '$85M', status: 'Active' },
          { name: 'Refurbished Tech', channel: 'Meta', ctr: '2.4%', roas: 3.1, budget: '$22M', status: 'Active' }
        ],
        suggestions: [
          'Target refurbished/secondhand market — eBay\'s ads focus too heavily on new goods',
          'Exploit eBay\'s low mobile CTR (1.8%) with mobile-optimised creative sequences',
          'Focus on collectibles niche — eBay\'s ad targeting here is very broad'
        ],
        audiences: [{ label: 'Bargain Hunters 35–55', pct: 44 }, { label: 'Tech Enthusiasts 25–40', pct: 28 }, { label: 'Collectors 40–65', pct: 18 }, { label: 'Resellers 20–35', pct: 10 }],
        topKeywords: ['buy used', 'auction online', 'cheap electronics', 'vintage items'],
        estimatedROI: '+22% CPA reduction by targeting eBay\'s underperforming segments'
      },
      {
        name: 'Etsy', url: 'etsy.com', logo: 'E',
        traffic: '340M', ctr: '3.6%', roas: 4.2, adSpend: '$89M/mo',
        topChannel: 'Pinterest Ads', threatLevel: 'medium',
        campaigns: [
          { name: 'Handmade for You', channel: 'Pinterest', ctr: '4.1%', roas: 5.1, budget: '$18M', status: 'Active' },
          { name: 'Gift Season', channel: 'Google', ctr: '3.3%', roas: 3.8, budget: '$24M', status: 'Active' }
        ],
        suggestions: [
          'Outperform Etsy\'s seasonal ad strategy with evergreen personalised gifting campaigns',
          'Target the Etsy artisan audience on TikTok — Etsy has virtually no TikTok presence',
          'Use sustainability messaging — Etsy buyers respond strongly to eco-friendly positioning'
        ],
        audiences: [{ label: 'Gift Buyers 28–45', pct: 42 }, { label: 'Craft Enthusiasts', pct: 26 }, { label: 'Interior Designers', pct: 20 }, { label: 'Wedding Planners', pct: 12 }],
        topKeywords: ['handmade gifts', 'personalised gifts', 'unique products', 'artisan'],
        estimatedROI: '+31% engagement with artisan-focused creative strategy'
      },
      {
        name: 'Wayfair', url: 'wayfair.com', logo: 'W',
        traffic: '180M', ctr: '2.7%', roas: 3.4, adSpend: '$148M/mo',
        topChannel: 'Google Display', threatLevel: 'low',
        campaigns: [
          { name: 'Home Refresh', channel: 'Google', ctr: '2.8%', roas: 3.6, budget: '$42M', status: 'Active' },
          { name: 'Way Day Sale', channel: 'Meta', ctr: '3.2%', roas: 4.1, budget: '$28M', status: 'Seasonal' }
        ],
        suggestions: [
          'Exploit Wayfair\'s weak local delivery messaging — consumers want fast delivery assurance',
          'Target interior design aspirations on Instagram — Wayfair\'s creative is product-first, not lifestyle-first',
          'Use AR furniture visualisation messaging — Wayfair\'s AR is underadvertised'
        ],
        audiences: [{ label: 'New Homeowners 28–42', pct: 38 }, { label: 'Home Renovators 35–55', pct: 31 }, { label: 'Apartment Dwellers 22–35', pct: 20 }, { label: 'Interior Designers', pct: 11 }],
        topKeywords: ['home furniture', 'online furniture store', 'home decor', 'sofa sale'],
        estimatedROI: '+18% ROAS gain by leading with lifestyle imagery vs. product images'
      }
    ]
  },

  fintech: {
    name: 'Fintech & Finance',
    keywords: ['forex','trading','invest','finance','fintech','crypto','bank','payment','money','loan','credit','insurance','wealth','fund','stock','market','broker','fx','currency','etoro','ig markets','oanda','xm','plus500','revolut','wise','stripe','paypal','coinbase','robinhood','financial','capital','asset'],
    competitors: [
      {
        name: 'eToro', url: 'etoro.com', logo: 'eT',
        traffic: '38M', ctr: '4.1%', roas: 5.8, adSpend: '$62M/mo',
        topChannel: 'Google Search', threatLevel: 'high',
        campaigns: [
          { name: 'Copy Trading Launch', channel: 'Google', ctr: '4.8%', roas: 6.2, budget: '$18M', status: 'Active' },
          { name: 'Zero Commission Stocks', channel: 'Meta', ctr: '3.6%', roas: 5.1, budget: '$12M', status: 'Active' },
          { name: 'Crypto Portfolio', channel: 'YouTube', ctr: '2.8%', roas: 4.3, budget: '$8M', status: 'Active' }
        ],
        suggestions: [
          'Counter eToro\'s "copy trading" angle with "intelligent trading" — positions you as smarter, not just social',
          'eToro\'s social proof ads lack specificity — use verified return data in your creatives',
          'Target eToro\'s frustrated users (high support complaint rate) with "simpler platform" messaging',
          'eToro underperforms in Islamic Finance markets — target halal investing with zero-interest USP'
        ],
        audiences: [{ label: 'Millennial Investors 25–38', pct: 42 }, { label: 'Crypto Enthusiasts 22–35', pct: 28 }, { label: 'Passive Income Seekers', pct: 18 }, { label: 'Day Traders 30–50', pct: 12 }],
        topKeywords: ['social trading', 'copy trading', 'zero commission', 'invest online'],
        estimatedROI: '+41% ROAS possible via targeted differentiator campaigns'
      },
      {
        name: 'IG Markets', url: 'ig.com', logo: 'IG',
        traffic: '22M', ctr: '3.8%', roas: 5.2, adSpend: '$38M/mo',
        topChannel: 'Google Search', threatLevel: 'high',
        campaigns: [
          { name: 'CFD Trading', channel: 'Google', ctr: '4.2%', roas: 5.8, budget: '$14M', status: 'Active' },
          { name: 'Spread Betting UK', channel: 'Display', ctr: '2.1%', roas: 3.4, budget: '$6M', status: 'Active' }
        ],
        suggestions: [
          'IG\'s ads focus on experienced traders — capture the "first-time trader" segment with education-first messaging',
          'IG underinvests in video creative — video ads convert 3× better in this vertical',
          'Target IG\'s UK audience with localised pricing advantages'
        ],
        audiences: [{ label: 'Active Traders 30–55', pct: 48 }, { label: 'Options Traders', pct: 26 }, { label: 'Forex Specialists', pct: 16 }, { label: 'Index Investors', pct: 10 }],
        topKeywords: ['spread betting', 'CFD trading', 'forex trading', 'financial spread'],
        estimatedROI: '+29% lead quality improvement by targeting educational entry points'
      },
      {
        name: 'Plus500', url: 'plus500.com', logo: 'P5',
        traffic: '15M', ctr: '3.3%', roas: 4.6, adSpend: '$28M/mo',
        topChannel: 'Google Search', threatLevel: 'medium',
        campaigns: [
          { name: 'CFD Platform', channel: 'Google', ctr: '3.6%', roas: 4.9, budget: '$10M', status: 'Active' },
          { name: 'Sports Sponsorship', channel: 'Display', ctr: '1.8%', roas: 2.8, budget: '$5M', status: 'Active' }
        ],
        suggestions: [
          'Plus500 relies heavily on sports sponsorship — digital performance ads outperform by 2.4×',
          'Exploit their slow platform UX in comparisons — speed and simplicity resonate strongly',
          'Plus500\'s mobile creative is poor — mobile-first creative sequences outperform their ads by 3.1×'
        ],
        audiences: [{ label: 'Weekend Traders 28–45', pct: 39 }, { label: 'Sports Bettors Converting', pct: 24 }, { label: 'Tech-Savvy 25–35', pct: 22 }, { label: 'Index Watchers 40–60', pct: 15 }],
        topKeywords: ['CFD platform', 'trading app', 'stock trading', 'forex app'],
        estimatedROI: '+34% conversion rate increase vs. Plus500\'s generic messaging'
      },
      {
        name: 'XM Group', url: 'xm.com', logo: 'XM',
        traffic: '12M', ctr: '2.9%', roas: 4.1, adSpend: '$22M/mo',
        topChannel: 'Google Search', threatLevel: 'medium',
        campaigns: [
          { name: 'Forex No Deposit Bonus', channel: 'Google', ctr: '3.8%', roas: 3.2, budget: '$8M', status: 'Active' },
          { name: 'MT4 Platform', channel: 'Meta', ctr: '2.2%', roas: 3.8, budget: '$4M', status: 'Active' }
        ],
        suggestions: [
          'XM\'s bonus-first strategy attracts low-quality leads — position your genuine value over gimmicks',
          'XM underperforms in Asia Pacific — strong opportunity with localised campaigns in SEA',
          'XM\'s educational content is minimal — educational ad sequences generate 4× longer LTV'
        ],
        audiences: [{ label: 'New Forex Traders', pct: 45 }, { label: 'Bonus Seekers', pct: 28 }, { label: 'Southeast Asia', pct: 15 }, { label: 'Middle East Traders', pct: 12 }],
        topKeywords: ['forex no deposit bonus', 'MT4 platform', 'forex broker', 'currency trading'],
        estimatedROI: '+45% LTV improvement via education-first funnel strategy'
      },
      {
        name: 'Revolut', url: 'revolut.com', logo: 'Rv',
        traffic: '85M', ctr: '3.5%', roas: 4.9, adSpend: '$48M/mo',
        topChannel: 'Meta Ads', threatLevel: 'high',
        campaigns: [
          { name: 'Travel Card Europe', channel: 'Meta', ctr: '4.2%', roas: 5.8, budget: '$16M', status: 'Active' },
          { name: 'Business Accounts', channel: 'LinkedIn', ctr: '2.8%', roas: 4.2, budget: '$8M', status: 'Active' },
          { name: 'Crypto Features', channel: 'TikTok', ctr: '3.9%', roas: 3.6, budget: '$6M', status: 'Active' }
        ],
        suggestions: [
          'Revolut\'s ads are lifestyle-heavy — functional benefit messaging converts 28% better for banking apps',
          'Target Revolut\'s pain point: poor customer service — position reliability and support as core USPs',
          'Revolut underserves SMB market on LinkedIn — B2B fintech campaigns here have 40% lower CPL'
        ],
        audiences: [{ label: 'Digital Nomads 25–38', pct: 34 }, { label: 'Travellers 28–45', pct: 28 }, { label: 'SMB Owners 30–50', pct: 22 }, { label: 'Crypto Users 22–35', pct: 16 }],
        topKeywords: ['travel card', 'international banking', 'no foreign fees', 'digital bank'],
        estimatedROI: '+38% lower CPL by targeting Revolut\'s service gaps'
      }
    ]
  },

  saas: {
    name: 'SaaS & Software',
    keywords: ['software','saas','platform','tool','app','crm','erp','api','cloud','subscription','b2b','enterprise','productivity','automation','workflow','integration','dashboard','analytics','reporting','hubspot','salesforce','zendesk','slack','notion','asana','jira','monday','clickup','freshdesk','intercom','mailchimp','hootsuite'],
    competitors: [
      {
        name: 'HubSpot', url: 'hubspot.com', logo: 'HS',
        traffic: '142M', ctr: '3.9%', roas: 5.4, adSpend: '$88M/mo',
        topChannel: 'Google Search', threatLevel: 'high',
        campaigns: [
          { name: 'Free CRM Campaign', channel: 'Google', ctr: '4.6%', roas: 6.1, budget: '$24M', status: 'Active' },
          { name: 'Marketing Hub', channel: 'LinkedIn', ctr: '2.8%', roas: 4.8, budget: '$14M', status: 'Active' },
          { name: 'Inbound Marketing', channel: 'YouTube', ctr: '2.2%', roas: 3.9, budget: '$8M', status: 'Active' }
        ],
        suggestions: [
          'HubSpot\'s free tier creates strong top-of-funnel — compete on time-to-value in trials',
          'HubSpot is weak on AI features in ads — lead with genuine AI automation in your messaging',
          'HubSpot\'s enterprise messaging is complex — simplicity-first ads convert 31% better',
          'Target HubSpot\'s over-priced upsell frustration with transparent pricing messaging'
        ],
        audiences: [{ label: 'Marketing Managers 30–45', pct: 38 }, { label: 'Sales Teams 25–40', pct: 28 }, { label: 'Agency Owners', pct: 20 }, { label: 'SMB CEOs 35–55', pct: 14 }],
        topKeywords: ['free CRM', 'marketing automation', 'email marketing platform', 'inbound marketing'],
        estimatedROI: '+32% trial conversion vs. HubSpot\'s generic onboarding messaging'
      },
      {
        name: 'Salesforce', url: 'salesforce.com', logo: 'SF',
        traffic: '98M', ctr: '2.8%', roas: 4.2, adSpend: '$124M/mo',
        topChannel: 'Google Search', threatLevel: 'high',
        campaigns: [
          { name: 'Einstein AI CRM', channel: 'Google', ctr: '3.1%', roas: 4.6, budget: '$38M', status: 'Active' },
          { name: 'Sales Cloud', channel: 'LinkedIn', ctr: '2.4%', roas: 3.8, budget: '$22M', status: 'Active' }
        ],
        suggestions: [
          'Salesforce is widely perceived as over-complex and over-priced — simplicity messaging dominates',
          'Salesforce AI (Einstein) is expensive — compete with accessible AI at 1/5th the cost',
          'Target Salesforce implementation frustration — 70% of implementations take longer than expected'
        ],
        audiences: [{ label: 'Enterprise Sales Leaders 40–55', pct: 42 }, { label: 'IT Directors', pct: 24 }, { label: 'RevOps Teams', pct: 20 }, { label: 'SMB Sales Managers', pct: 14 }],
        topKeywords: ['CRM software', 'sales automation', 'enterprise CRM', 'customer success'],
        estimatedROI: '+28% win rate in SMB segment vs. Salesforce complex sales cycle'
      },
      {
        name: 'Monday.com', url: 'monday.com', logo: 'Mo',
        traffic: '62M', ctr: '3.4%', roas: 4.7, adSpend: '$52M/mo',
        topChannel: 'Google Search', threatLevel: 'medium',
        campaigns: [
          { name: 'Work OS Launch', channel: 'Google', ctr: '3.8%', roas: 5.2, budget: '$18M', status: 'Active' },
          { name: 'Team Collaboration', channel: 'Meta', ctr: '2.9%', roas: 4.1, budget: '$12M', status: 'Active' },
          { name: 'Remote Teams', channel: 'LinkedIn', ctr: '2.1%', roas: 3.6, budget: '$8M', status: 'Active' }
        ],
        suggestions: [
          'Monday.com uses broad "Work OS" messaging — target specific verticals (construction, marketing, IT) instead',
          'Monday.com\'s pricing pages convert poorly — clear ROI calculators in ads convert 2.8× better',
          'Exploit Monday\'s weak project template library messaging — template-first landing pages work well'
        ],
        audiences: [{ label: 'Project Managers 28–45', pct: 36 }, { label: 'Remote Teams 25–40', pct: 30 }, { label: 'Creative Agencies', pct: 20 }, { label: 'IT Teams 30–50', pct: 14 }],
        topKeywords: ['project management software', 'team collaboration tool', 'work management', 'agile tool'],
        estimatedROI: '+39% lead gen improvement via vertical-specific campaigns'
      },
      {
        name: 'Mailchimp', url: 'mailchimp.com', logo: 'MC',
        traffic: '78M', ctr: '3.1%', roas: 4.3, adSpend: '$36M/mo',
        topChannel: 'Google Search', threatLevel: 'medium',
        campaigns: [
          { name: 'Email Marketing Free', channel: 'Google', ctr: '3.6%', roas: 4.8, budget: '$12M', status: 'Active' },
          { name: 'All-in-one Marketing', channel: 'Meta', ctr: '2.7%', roas: 3.6, budget: '$8M', status: 'Active' }
        ],
        suggestions: [
          'Mailchimp\'s free plan attracts low-converting users — target paid-tier migration keywords',
          'Mailchimp\'s deliverability complaints are high — highlight your superior inbox rates',
          'Mailchimp\'s automation is complex — simple automation setup messaging converts 2.2× better'
        ],
        audiences: [{ label: 'Small Business Owners 28–45', pct: 42 }, { label: 'Ecommerce Brands', pct: 28 }, { label: 'Non-profits', pct: 16 }, { label: 'Freelancers', pct: 14 }],
        topKeywords: ['email marketing', 'newsletter software', 'email automation', 'free email tool'],
        estimatedROI: '+25% ROAS via targeting Mailchimp deliverability pain points'
      },
      {
        name: 'Zendesk', url: 'zendesk.com', logo: 'ZD',
        traffic: '44M', ctr: '2.6%', roas: 3.8, adSpend: '$28M/mo',
        topChannel: 'Google Search', threatLevel: 'low',
        campaigns: [
          { name: 'Customer Service Suite', channel: 'Google', ctr: '2.9%', roas: 4.1, budget: '$10M', status: 'Active' },
          { name: 'AI Support', channel: 'LinkedIn', ctr: '2.2%', roas: 3.4, budget: '$6M', status: 'Active' }
        ],
        suggestions: [
          'Zendesk\'s pricing increases have frustrated customers — target migration with competitor comparison ads',
          'Zendesk AI messaging is vague — specific AI ticket reduction claims convert 3.4× better',
          'Target Zendesk\'s weak SMB onboarding with "set up in 1 hour" messaging'
        ],
        audiences: [{ label: 'Customer Support Managers 30–48', pct: 44 }, { label: 'SaaS Companies', pct: 26 }, { label: 'E-commerce Support', pct: 18 }, { label: 'Enterprise IT', pct: 12 }],
        topKeywords: ['customer service software', 'help desk software', 'support ticket system', 'live chat'],
        estimatedROI: '+22% conversion rate by targeting Zendesk pricing frustration'
      }
    ]
  },

  crypto: {
    name: 'Crypto & Web3',
    keywords: ['crypto','bitcoin','ethereum','blockchain','defi','nft','web3','token','wallet','exchange','binance','coinbase','kraken','bybit','bitfinex','kucoin','metamask','ledger','staking','yield','altcoin','trading','decentralised'],
    competitors: [
      {
        name: 'Coinbase', url: 'coinbase.com', logo: 'CB',
        traffic: '180M', ctr: '3.8%', roas: 5.1, adSpend: '$58M/mo',
        topChannel: 'Google Search', threatLevel: 'high',
        campaigns: [
          { name: 'Buy Bitcoin Easily', channel: 'Google', ctr: '4.2%', roas: 5.6, budget: '$18M', status: 'Active' },
          { name: 'Earn Crypto Rewards', channel: 'Meta', ctr: '3.4%', roas: 4.8, budget: '$12M', status: 'Active' },
          { name: 'Coinbase One', channel: 'YouTube', ctr: '2.6%', roas: 3.9, budget: '$8M', status: 'Active' }
        ],
        suggestions: [
          'Coinbase focuses on trust and regulation — compete with lower fees and advanced features',
          'Coinbase\'s UI is overly simplified — target advanced traders who feel limited',
          'Coinbase has high fees vs. competitors — aggressive fee comparison ads capture budget-conscious traders',
          'Target Coinbase\'s non-US user frustration with global-first positioning'
        ],
        audiences: [{ label: 'Crypto Beginners 20–35', pct: 38 }, { label: 'HODLers 28–45', pct: 26 }, { label: 'DeFi Users 22–35', pct: 22 }, { label: 'Institutional 35–55', pct: 14 }],
        topKeywords: ['buy bitcoin', 'crypto exchange', 'buy ethereum', 'crypto wallet'],
        estimatedROI: '+42% user acquisition by targeting Coinbase fee dissatisfaction'
      },
      {
        name: 'Binance', url: 'binance.com', logo: 'BN',
        traffic: '280M', ctr: '3.2%', roas: 4.6, adSpend: '$42M/mo',
        topChannel: 'Google Search', threatLevel: 'high',
        campaigns: [
          { name: 'Spot Trading', channel: 'Google', ctr: '3.6%', roas: 5.1, budget: '$14M', status: 'Active' },
          { name: 'DeFi Yield', channel: 'Twitter/X', ctr: '2.8%', roas: 3.8, budget: '$8M', status: 'Active' }
        ],
        suggestions: [
          'Binance\'s regulatory issues create trust concern — lead with compliance and security messaging',
          'Binance\'s UI is complex for beginners — simple onboarding ads outperform their volume-heavy messaging',
          'Target regions where Binance faces restrictions with your compliant, accessible alternative'
        ],
        audiences: [{ label: 'Active Traders 22–38', pct: 44 }, { label: 'DeFi Enthusiasts', pct: 26 }, { label: 'Altcoin Investors', pct: 18 }, { label: 'Futures Traders', pct: 12 }],
        topKeywords: ['low fee crypto exchange', 'spot trading', 'futures trading', 'altcoins'],
        estimatedROI: '+35% trust-based conversion vs. Binance regulatory uncertainty'
      },
      {
        name: 'Kraken', url: 'kraken.com', logo: 'KR',
        traffic: '42M', ctr: '2.9%', roas: 4.1, adSpend: '$18M/mo',
        topChannel: 'Google Search', threatLevel: 'medium',
        campaigns: [
          { name: 'Secure Trading', channel: 'Google', ctr: '3.2%', roas: 4.4, budget: '$6M', status: 'Active' },
          { name: 'Staking Rewards', channel: 'Meta', ctr: '2.6%', roas: 3.7, budget: '$4M', status: 'Active' }
        ],
        suggestions: [
          'Kraken leans heavily on security — differentiate with user experience and product variety',
          'Kraken has low social media presence — community-building ads generate 3× more organic growth',
          'Target Kraken\'s limited fiat currency options with multi-currency positioning'
        ],
        audiences: [{ label: 'Security-Conscious 30–50', pct: 42 }, { label: 'Experienced Traders', pct: 28 }, { label: 'Stakers 25–40', pct: 18 }, { label: 'Privacy Users', pct: 12 }],
        topKeywords: ['secure crypto exchange', 'bitcoin staking', 'pro trading', 'OTC crypto'],
        estimatedROI: '+28% market share capture via superior UX messaging'
      },
      {
        name: 'ByBit', url: 'bybit.com', logo: 'BY',
        traffic: '68M', ctr: '3.4%', roas: 4.8, adSpend: '$32M/mo',
        topChannel: 'Google Search', threatLevel: 'medium',
        campaigns: [
          { name: 'Derivatives Trading', channel: 'Google', ctr: '3.8%', roas: 5.2, budget: '$10M', status: 'Active' },
          { name: 'Copy Trading', channel: 'Twitter/X', ctr: '2.9%', roas: 3.9, budget: '$6M', status: 'Active' }
        ],
        suggestions: [
          'ByBit focuses on derivatives — capture spot traders who prefer simpler products',
          'ByBit\'s localisation in Asian markets is strong — compete with superior Western market targeting',
          'ByBit\'s copy trading feature is underadvertised — a similar feature with stronger messaging would convert well'
        ],
        audiences: [{ label: 'Derivatives Traders 25–40', pct: 40 }, { label: 'Asian Markets', pct: 32 }, { label: 'Copy Traders 22–35', pct: 16 }, { label: 'Bot Traders', pct: 12 }],
        topKeywords: ['derivatives trading', 'crypto futures', 'leverage trading', 'crypto copy trade'],
        estimatedROI: '+31% Western market acquisition vs. ByBit\'s Asian-focused messaging'
      },
      {
        name: 'Ledger', url: 'ledger.com', logo: 'LG',
        traffic: '22M', ctr: '2.8%', roas: 4.2, adSpend: '$12M/mo',
        topChannel: 'Google Search', threatLevel: 'low',
        campaigns: [
          { name: 'Hardware Wallet Security', channel: 'Google', ctr: '3.1%', roas: 4.6, budget: '$4M', status: 'Active' },
          { name: 'Protect Your Crypto', channel: 'Meta', ctr: '2.4%', roas: 3.8, budget: '$3M', status: 'Active' }
        ],
        suggestions: [
          'Ledger\'s data breach history creates trust concerns — "trust rebuilt" messaging resonates strongly',
          'Ledger focuses on single-device messaging — family/multi-wallet packages have 2.8× higher AOV',
          'Target Ledger customers post-hack with new security-first competitor offering'
        ],
        audiences: [{ label: 'Long-term HODLers 28–50', pct: 46 }, { label: 'Security-First 35–55', pct: 28 }, { label: 'NFT Collectors', pct: 16 }, { label: 'Institutional', pct: 10 }],
        topKeywords: ['hardware wallet', 'cold storage crypto', 'secure bitcoin wallet', 'crypto safe'],
        estimatedROI: '+24% market share by addressing Ledger trust gaps'
      }
    ]
  },

  travel: {
    name: 'Travel & Hospitality',
    keywords: ['travel','hotel','flight','booking','trip','vacation','holiday','tour','cruise','airbnb','booking.com','expedia','tripadvisor','hostel','resort','airline','destinations','visa','tourism','accommodation','stay','rent'],
    competitors: [
      {
        name: 'Booking.com', url: 'booking.com', logo: 'BK',
        traffic: '680M', ctr: '4.2%', roas: 5.8, adSpend: '$1.2B/mo',
        topChannel: 'Google Hotels', threatLevel: 'high',
        campaigns: [
          { name: 'Genius Loyalty', channel: 'Google', ctr: '4.8%', roas: 6.4, budget: '$280M', status: 'Active' },
          { name: 'Free Cancellation', channel: 'Meta', ctr: '3.6%', roas: 5.1, budget: '$180M', status: 'Active' },
          { name: 'Last Minute Deals', channel: 'Push', ctr: '5.2%', roas: 4.8, budget: '$60M', status: 'Active' }
        ],
        suggestions: [
          'Booking.com\'s loyalty program ads are generic — personalised Genius tier messaging converts 3.4× better',
          'Booking.com underperforms in luxury segment — target premium travellers with curated experiences',
          'Exploit Booking.com\'s weak B2B travel messaging — corporate travel is an underpenetrated opportunity',
          'Booking.com\'s host-facing ads are poor — attract more unique properties with host acquisition campaigns'
        ],
        audiences: [{ label: 'Budget Travellers 22–38', pct: 36 }, { label: 'Family Travellers 30–50', pct: 28 }, { label: 'Business Travellers', pct: 22 }, { label: 'Luxury Seekers 35–55', pct: 14 }],
        topKeywords: ['hotel booking', 'cheap hotels', 'free cancellation hotel', 'last minute travel'],
        estimatedROI: '+38% bookings via luxury niche targeting Booking.com ignores'
      },
      {
        name: 'Expedia', url: 'expedia.com', logo: 'EX',
        traffic: '280M', ctr: '3.6%', roas: 4.9, adSpend: '$580M/mo',
        topChannel: 'Google Search', threatLevel: 'high',
        campaigns: [
          { name: 'Bundle & Save', channel: 'Google', ctr: '3.9%', roas: 5.4, budget: '$140M', status: 'Active' },
          { name: 'One Key Loyalty', channel: 'Meta', ctr: '3.1%', roas: 4.2, budget: '$80M', status: 'Active' }
        ],
        suggestions: [
          'Expedia\'s bundle messaging is complex — simple "save X% on flights+hotel" converts 2.1× better',
          'Expedia underinvests in TikTok travel content — travel inspiration content drives massive organic reach',
          'Target Expedia\'s weak solo travel segment with personalised solo adventure campaigns'
        ],
        audiences: [{ label: 'Couples 28–45', pct: 34 }, { label: 'Family Planners 32–50', pct: 28 }, { label: 'Solo Travellers 22–38', pct: 24 }, { label: 'Business Class', pct: 14 }],
        topKeywords: ['cheap flights and hotels', 'travel packages', 'holiday deals', 'flight hotel bundle'],
        estimatedROI: '+29% booking rate vs. Expedia\'s bundle complexity'
      },
      {
        name: 'Airbnb', url: 'airbnb.com', logo: 'AB',
        traffic: '420M', ctr: '3.9%', roas: 5.2, adSpend: '$280M/mo',
        topChannel: 'Meta Ads', threatLevel: 'high',
        campaigns: [
          { name: 'Live Anywhere', channel: 'Meta', ctr: '4.4%', roas: 5.8, budget: '$82M', status: 'Active' },
          { name: 'Host with Airbnb', channel: 'Google', ctr: '3.2%', roas: 4.8, budget: '$48M', status: 'Active' },
          { name: 'Airbnb Experiences', channel: 'TikTok', ctr: '4.8%', roas: 3.9, budget: '$28M', status: 'Active' }
        ],
        suggestions: [
          'Airbnb\'s aspirational lifestyle ads attract price-sensitive users — lead with value-for-money messaging',
          'Airbnb is weak on business travel — compete for corporate housing with monthly stay targeting',
          'Target Airbnb host frustration with management complexity via host-first platform positioning'
        ],
        audiences: [{ label: 'Millennials 25–38', pct: 40 }, { label: 'Digital Nomads', pct: 24 }, { label: 'Group Travel 28–45', pct: 20 }, { label: 'Luxury Seekers', pct: 16 }],
        topKeywords: ['unique accommodation', 'holiday home rental', 'vacation rental', 'experience travel'],
        estimatedROI: '+33% host acquisition rate via Airbnb complexity differentiator'
      },
      {
        name: 'TripAdvisor', url: 'tripadvisor.com', logo: 'TA',
        traffic: '180M', ctr: '2.8%', roas: 3.6, adSpend: '$82M/mo',
        topChannel: 'Google Search', threatLevel: 'medium',
        campaigns: [
          { name: 'Restaurant Discovery', channel: 'Google', ctr: '3.2%', roas: 3.9, budget: '$24M', status: 'Active' },
          { name: 'Hotel Reviews', channel: 'Display', ctr: '1.8%', roas: 2.6, budget: '$12M', status: 'Active' }
        ],
        suggestions: [
          'TripAdvisor\'s review-heavy content has declining trust — use verified booking data instead',
          'TripAdvisor is losing mobile engagement — mobile-first gamified discovery converts 3× better',
          'Target TripAdvisor\'s weak Gen Z presence with short-form video travel content'
        ],
        audiences: [{ label: 'Research-Heavy Planners 30–55', pct: 42 }, { label: 'Foodies 25–45', pct: 26 }, { label: 'Family Planners', pct: 20 }, { label: 'Budget Seekers', pct: 12 }],
        topKeywords: ['hotel reviews', 'restaurant near me', 'travel reviews', 'things to do'],
        estimatedROI: '+21% engagement vs. TripAdvisor\'s static review format'
      },
      {
        name: 'Hotels.com', url: 'hotels.com', logo: 'HC',
        traffic: '120M', ctr: '3.1%', roas: 4.2, adSpend: '$148M/mo',
        topChannel: 'Google Hotels', threatLevel: 'medium',
        campaigns: [
          { name: 'Collect Nights Free', channel: 'Google', ctr: '3.4%', roas: 4.8, budget: '$42M', status: 'Active' },
          { name: 'Weekend Escapes', channel: 'Meta', ctr: '2.9%', roas: 3.8, budget: '$28M', status: 'Active' }
        ],
        suggestions: [
          'Hotels.com loyalty is underperforming since One Key launch — target lapsed users with re-engagement',
          'Hotels.com underinvests in boutique hotel discovery — a niche hospitality vertical converts 3.1× better',
          'Target Hotels.com\'s weak sustainability messaging — eco-travel is growing 28% annually'
        ],
        audiences: [{ label: 'Loyalty Members 30–50', pct: 38 }, { label: 'Weekend Trippers 25–42', pct: 28 }, { label: 'Points Collectors', pct: 22 }, { label: 'Business Travellers', pct: 12 }],
        topKeywords: ['hotel loyalty program', 'free night hotel', 'best hotel deals', 'boutique hotels'],
        estimatedROI: '+26% re-engagement via loyalty program competitive positioning'
      }
    ]
  },

  education: {
    name: 'Education & E-Learning',
    keywords: ['course','learn','education','training','skill','degree','certificate','online learning','elearning','coursera','udemy','khan','edx','skillshare','masterclass','duolingo','tutoring','academy','university','study','teach','mentor','bootcamp'],
    competitors: [
      {
        name: 'Coursera', url: 'coursera.org', logo: 'CO',
        traffic: '148M', ctr: '3.4%', roas: 4.8, adSpend: '$68M/mo',
        topChannel: 'Google Search', threatLevel: 'high',
        campaigns: [
          { name: 'University Certificates', channel: 'Google', ctr: '3.8%', roas: 5.2, budget: '$20M', status: 'Active' },
          { name: 'Career Change', channel: 'LinkedIn', ctr: '2.6%', roas: 4.6, budget: '$14M', status: 'Active' },
          { name: 'Free Trial', channel: 'Meta', ctr: '3.1%', roas: 3.8, budget: '$10M', status: 'Active' }
        ],
        suggestions: [
          'Coursera\'s institution-heavy messaging is aspirational but slow — speed-to-career messaging wins',
          'Coursera underperforms in vocational skills — practical skill-based ads convert 3.2× better',
          'Target Coursera\'s high dropout rate frustration with structured accountability programs',
          'Coursera\'s job placement data is vague — specific salary increase claims convert 4× better'
        ],
        audiences: [{ label: 'Career Changers 28–42', pct: 38 }, { label: 'Professionals Upskilling', pct: 28 }, { label: 'Recent Graduates 22–28', pct: 22 }, { label: 'Corporate Learners', pct: 12 }],
        topKeywords: ['online certificate', 'university online courses', 'professional development', 'data science course'],
        estimatedROI: '+36% enrollment via career-outcome-specific targeting'
      },
      {
        name: 'Udemy', url: 'udemy.com', logo: 'UD',
        traffic: '128M', ctr: '3.1%', roas: 4.2, adSpend: '$48M/mo',
        topChannel: 'Google Search', threatLevel: 'high',
        campaigns: [
          { name: 'Sale: 80% Off', channel: 'Google', ctr: '4.2%', roas: 3.8, budget: '$16M', status: 'Active' },
          { name: 'Learn Programming', channel: 'Meta', ctr: '2.8%', roas: 3.6, budget: '$10M', status: 'Active' }
        ],
        suggestions: [
          'Udemy\'s perpetual sale strategy devalues courses — premium positioning converts higher LTV users',
          'Udemy has poor course quality control — curated expert content messaging generates trust',
          'Udemy B2B (for Teams) is underadvertised — corporate learning is 6× higher LTV than individual'
        ],
        audiences: [{ label: 'Self-Learners 22–40', pct: 44 }, { label: 'Tech Enthusiasts', pct: 26 }, { label: 'Creative Professionals', pct: 18 }, { label: 'Business Teams', pct: 12 }],
        topKeywords: ['online courses', 'learn python', 'graphic design course', 'digital marketing course'],
        estimatedROI: '+28% LTV by targeting Udemy\'s quality-concerned learners'
      },
      {
        name: 'Skillshare', url: 'skillshare.com', logo: 'SK',
        traffic: '42M', ctr: '2.9%', roas: 3.8, adSpend: '$22M/mo',
        topChannel: 'Meta Ads', threatLevel: 'medium',
        campaigns: [
          { name: 'Creative Learning', channel: 'Meta', ctr: '3.4%', roas: 4.2, budget: '$8M', status: 'Active' },
          { name: 'Unlimited Access', channel: 'YouTube', ctr: '2.4%', roas: 3.2, budget: '$5M', status: 'Active' }
        ],
        suggestions: [
          'Skillshare\'s creative niche is well-defined — expand into tech and business to compete for more users',
          'Skillshare underinvests in TikTok creator partnerships — creator-led ads convert 5.2× better',
          'Skillshare\'s retention is weak after month 2 — target with re-engagement campaigns and community features'
        ],
        audiences: [{ label: 'Creative Professionals 22–38', pct: 46 }, { label: 'Hobbyists 25–50', pct: 26 }, { label: 'Freelancers', pct: 18 }, { label: 'Students', pct: 10 }],
        topKeywords: ['creative courses', 'illustration course', 'video editing tutorial', 'photography online'],
        estimatedROI: '+33% retention by targeting Skillshare\'s community gap'
      },
      {
        name: 'MasterClass', url: 'masterclass.com', logo: 'MC',
        traffic: '28M', ctr: '3.6%', roas: 5.1, adSpend: '$32M/mo',
        topChannel: 'Meta Ads', threatLevel: 'medium',
        campaigns: [
          { name: 'Celebrity Instructors', channel: 'Meta', ctr: '4.2%', roas: 5.8, budget: '$12M', status: 'Active' },
          { name: 'Gift MasterClass', channel: 'Google', ctr: '3.1%', roas: 4.8, budget: '$8M', status: 'Active' }
        ],
        suggestions: [
          'MasterClass is aspirational but light on practical application — pragmatic skill ads win',
          'MasterClass is over-reliant on celebrity appeal — expert practitioners often outperform celebrity instructors in trust',
          'MasterClass gifting campaigns are well-executed — replicate and improve with personalised gift recommendations'
        ],
        audiences: [{ label: 'Aspirational Learners 28–50', pct: 40 }, { label: 'Gift Buyers', pct: 28 }, { label: 'Creative Writers', pct: 18 }, { label: 'Entertainment Seekers', pct: 14 }],
        topKeywords: ['masterclass online', 'learn from experts', 'celebrity lessons', 'creative writing course'],
        estimatedROI: '+22% market capture via practical-outcome positioning vs. MasterClass aspiration'
      },
      {
        name: 'Duolingo', url: 'duolingo.com', logo: 'DL',
        traffic: '220M', ctr: '2.4%', roas: 3.2, adSpend: '$18M/mo',
        topChannel: 'Meta Ads', threatLevel: 'low',
        campaigns: [
          { name: 'Learn a Language Free', channel: 'Meta', ctr: '3.1%', roas: 3.8, budget: '$6M', status: 'Active' },
          { name: 'Duolingo Plus', channel: 'Google', ctr: '2.2%', roas: 3.4, budget: '$4M', status: 'Active' }
        ],
        suggestions: [
          'Duolingo\'s gamification is unique but retention drops — long-term learning outcome ads convert better',
          'Target Duolingo\'s weak business language segment with professional language learning positioning',
          'Duolingo\'s monetisation is limited — position premium language learning at 3× better outcomes'
        ],
        audiences: [{ label: 'Language Enthusiasts 18–35', pct: 48 }, { label: 'Travellers 25–45', pct: 24 }, { label: 'Students 16–24', pct: 18 }, { label: 'Business Professionals', pct: 10 }],
        topKeywords: ['free language learning', 'learn spanish', 'learn french app', 'language app'],
        estimatedROI: '+19% premium conversion by targeting Duolingo free-tier limitations'
      }
    ]
  },

  marketing: {
    name: 'Marketing & Analytics',
    keywords: ['marketing','seo','analytics','ads','advertising','campaign','content','social media','email','crm','semrush','ahrefs','moz','sprout','hootsuite','buffer','mailchimp','klaviyo','marketo','pardot','hubspot','ad agency','media buyer','ppc','keyword','backlink','traffic','conversion','funnel'],
    competitors: [
      {
        name: 'Semrush', url: 'semrush.com', logo: 'SR',
        traffic: '96M', ctr: '3.6%', roas: 5.1, adSpend: '$42M/mo',
        topChannel: 'Google Search', threatLevel: 'high',
        campaigns: [
          { name: 'SEO Toolkit', channel: 'Google', ctr: '4.1%', roas: 5.8, budget: '$14M', status: 'Active' },
          { name: 'Competitor Research', channel: 'Meta', ctr: '2.9%', roas: 4.2, budget: '$8M', status: 'Active' },
          { name: 'Content Marketing', channel: 'LinkedIn', ctr: '2.4%', roas: 4.6, budget: '$6M', status: 'Active' }
        ],
        suggestions: [
          'Semrush provides data dashboards — InfoGenie provides autonomous action. Lead with this differentiation.',
          'Semrush\'s onboarding is complex — simplicity-first ads with "results in 24 hours" convert better',
          'Semrush underinvests in automated campaign execution messaging — this is InfoGenie\'s core advantage',
          'Semrush targets SEO specialists — expand to CMOs and business owners who want results, not data'
        ],
        audiences: [{ label: 'SEO Specialists 25–45', pct: 36 }, { label: 'Digital Marketers', pct: 28 }, { label: 'Agency Owners', pct: 22 }, { label: 'Content Teams', pct: 14 }],
        topKeywords: ['keyword research tool', 'SEO software', 'competitor analysis', 'backlink checker'],
        estimatedROI: '+48% market capture from Semrush\'s execution gap'
      },
      {
        name: 'SimilarWeb', url: 'similarweb.com', logo: 'SW',
        traffic: '38M', ctr: '3.1%', roas: 4.4, adSpend: '$28M/mo',
        topChannel: 'LinkedIn Ads', threatLevel: 'high',
        campaigns: [
          { name: 'Traffic Intelligence', channel: 'LinkedIn', ctr: '2.8%', roas: 4.8, budget: '$10M', status: 'Active' },
          { name: 'Market Research', channel: 'Google', ctr: '3.4%', roas: 4.2, budget: '$8M', status: 'Active' }
        ],
        suggestions: [
          'SimilarWeb sells data — position InfoGenie as the platform that converts data into campaigns automatically',
          'SimilarWeb\'s enterprise focus leaves SMB underserved — affordable intelligence for SMBs is a gap',
          'SimilarWeb has no AI generation — "intelligence to execution in one platform" is a direct differentiator'
        ],
        audiences: [{ label: 'Enterprise Strategy Teams', pct: 44 }, { label: 'Market Researchers', pct: 26 }, { label: 'Competitive Intel Teams', pct: 18 }, { label: 'Investors', pct: 12 }],
        topKeywords: ['website traffic data', 'competitor traffic analysis', 'market intelligence', 'digital insights'],
        estimatedROI: '+41% conversion via execution-first vs. SimilarWeb data-only positioning'
      },
      {
        name: 'AdCreative.ai', url: 'adcreative.ai', logo: 'AC',
        traffic: '8M', ctr: '4.2%', roas: 5.8, adSpend: '$8M/mo',
        topChannel: 'Meta Ads', threatLevel: 'medium',
        campaigns: [
          { name: 'AI Ad Generation', channel: 'Meta', ctr: '4.8%', roas: 6.2, budget: '$3M', status: 'Active' },
          { name: 'Better Ad Creative', channel: 'Google', ctr: '3.6%', roas: 4.8, budget: '$2M', status: 'Active' }
        ],
        suggestions: [
          'AdCreative.ai only generates — InfoGenie generates AND analyses AND deploys. Lead with full automation.',
          'AdCreative.ai lacks competitor intelligence integration — position InfoGenie as grounded in real data',
          'AdCreative.ai\'s quality is inconsistent — position verified performance benchmarks as your differentiator'
        ],
        audiences: [{ label: 'Performance Marketers 25–40', pct: 42 }, { label: 'Growth Hackers', pct: 28 }, { label: 'E-commerce Brands', pct: 18 }, { label: 'Ad Agencies', pct: 12 }],
        topKeywords: ['AI ad generator', 'AI ad creative', 'auto ad generation', 'performance creative'],
        estimatedROI: '+52% platform stickiness with full intelligence-to-execution loop'
      },
      {
        name: 'Hootsuite', url: 'hootsuite.com', logo: 'HT',
        traffic: '52M', ctr: '2.4%', roas: 3.6, adSpend: '$22M/mo',
        topChannel: 'Google Search', threatLevel: 'medium',
        campaigns: [
          { name: 'Social Media Management', channel: 'Google', ctr: '2.8%', roas: 3.9, budget: '$8M', status: 'Active' },
          { name: 'Agency Plan', channel: 'LinkedIn', ctr: '2.1%', roas: 3.4, budget: '$4M', status: 'Active' }
        ],
        suggestions: [
          'Hootsuite focuses on scheduling — InfoGenie adds competitor intelligence and autonomous optimisation',
          'Hootsuite\'s pricing increases have caused mass churn — target former users with migration campaigns',
          'Hootsuite has no AI ad generation — position as the next evolution of social marketing tools'
        ],
        audiences: [{ label: 'Social Media Managers 25–40', pct: 44 }, { label: 'Content Teams', pct: 26 }, { label: 'SMB Marketers', pct: 18 }, { label: 'Agency Teams', pct: 12 }],
        topKeywords: ['social media scheduler', 'social media management tool', 'content calendar', 'social analytics'],
        estimatedROI: '+29% customer acquisition from Hootsuite pricing frustration'
      },
      {
        name: 'Ahrefs', url: 'ahrefs.com', logo: 'AH',
        traffic: '44M', ctr: '3.3%', roas: 4.6, adSpend: '$14M/mo',
        topChannel: 'Google Search', threatLevel: 'medium',
        campaigns: [
          { name: 'Backlink Analysis', channel: 'Google', ctr: '3.8%', roas: 5.1, budget: '$5M', status: 'Active' },
          { name: 'SEO for Beginners', channel: 'YouTube', ctr: '2.6%', roas: 3.8, budget: '$3M', status: 'Active' }
        ],
        suggestions: [
          'Ahrefs is deep SEO — position InfoGenie as the paid marketing intelligence complement to Ahrefs SEO',
          'Ahrefs has no campaign automation — paid media teams are underserved by current Ahrefs positioning',
          'Ahrefs\' educational content is excellent — match with actionable AI execution messaging'
        ],
        audiences: [{ label: 'SEO Professionals 25–45', pct: 48 }, { label: 'Content Marketers', pct: 24 }, { label: 'Link Building Teams', pct: 16 }, { label: 'Technical SEOs', pct: 12 }],
        topKeywords: ['backlink checker', 'keyword difficulty', 'site audit', 'competitor keywords'],
        estimatedROI: '+35% paid media market capture from Ahrefs\' SEO-only positioning'
      }
    ]
  }
};

// Detect industry from URL
function detectIndustry(url) {
  const clean = url.toLowerCase().replace(/https?:\/\//, '').replace(/www\./, '');
  
  // Direct domain matches first
  const domainMap = {
    'shopify.com': 'ecommerce', 'amazon.com': 'ecommerce', 'ebay.com': 'ecommerce',
    'etsy.com': 'ecommerce', 'wayfair.com': 'ecommerce', 'woocommerce.com': 'ecommerce',
    'etoro.com': 'fintech', 'ig.com': 'fintech', 'plus500.com': 'fintech',
    'xm.com': 'fintech', 'revolut.com': 'fintech', 'wise.com': 'fintech',
    'robinhood.com': 'fintech', 'stripe.com': 'fintech', 'paypal.com': 'fintech',
    'hubspot.com': 'saas', 'salesforce.com': 'saas', 'monday.com': 'saas',
    'zendesk.com': 'saas', 'mailchimp.com': 'saas', 'slack.com': 'saas',
    'notion.com': 'saas', 'asana.com': 'saas', 'jira.com': 'saas',
    'coinbase.com': 'crypto', 'binance.com': 'crypto', 'kraken.com': 'crypto',
    'bybit.com': 'crypto', 'ledger.com': 'crypto', 'metamask.io': 'crypto',
    'booking.com': 'travel', 'expedia.com': 'travel', 'airbnb.com': 'travel',
    'tripadvisor.com': 'travel', 'hotels.com': 'travel', 'agoda.com': 'travel',
    'coursera.org': 'education', 'udemy.com': 'education', 'skillshare.com': 'education',
    'masterclass.com': 'education', 'duolingo.com': 'education', 'edx.org': 'education',
    'semrush.com': 'marketing', 'similarweb.com': 'marketing', 'adcreative.ai': 'marketing',
    'hootsuite.com': 'marketing', 'ahrefs.com': 'marketing', 'moz.com': 'marketing'
  };
  
  for (const [domain, industry] of Object.entries(domainMap)) {
    if (clean.includes(domain.replace('.com','').replace('.org','').replace('.ai','').replace('.io',''))) {
      return industry;
    }
  }
  
  // Keyword-based detection
  for (const [industryKey, data] of Object.entries(INDUSTRY_DB)) {
    const score = data.keywords.filter(kw => clean.includes(kw)).length;
    if (score >= 1) return industryKey;
  }
  
  // Default to marketing/saas for unknown
  return 'marketing';
}

// ============================================================
// INTELLIGENCE HUB DATA — Exclusive InfoGenie Features
// ============================================================
const INTELLIGENCE_DB = {
  ecommerce: {
    categoryScore: 31,
    shareOfVoice: [
      { name: 'Amazon', share: 38, trend: '+2%', color: '#FF9900' },
      { name: 'eBay', share: 18, trend: '-1%', color: '#86B817' },
      { name: 'Shopify', share: 14, trend: '+4%', color: '#96BF48' },
      { name: 'Etsy', share: 11, trend: '+1%', color: '#F56400' },
      { name: 'You', share: 5, trend: '+0%', color: '#00C9C8' },
      { name: 'Others', share: 14, trend: '', color: '#E5E7EB' }
    ],
    keywordGaps: [
      { keyword: 'best online store builder', volume: '74,000', topComp: 'Shopify', compCtr: '5.1%', yourRank: 'Not ranking', difficulty: 'Medium', score: 94, cpc: '$4.20' },
      { keyword: 'free shipping no minimum', volume: '110,000', topComp: 'Amazon', compCtr: '6.8%', yourRank: 'Not ranking', difficulty: 'High', score: 88, cpc: '$2.10' },
      { keyword: 'handmade gifts online', volume: '49,500', topComp: 'Etsy', compCtr: '4.3%', yourRank: 'Not ranking', difficulty: 'Low', score: 92, cpc: '$1.80' },
      { keyword: 'dropshipping supplier USA', volume: '33,100', topComp: 'Shopify', compCtr: '3.9%', yourRank: 'Not ranking', difficulty: 'Medium', score: 86, cpc: '$3.50' },
      { keyword: 'buy electronics online cheap', volume: '90,500', topComp: 'Amazon', compCtr: '4.7%', yourRank: 'Page 3', difficulty: 'High', score: 79, cpc: '$1.90' },
      { keyword: 'woocommerce vs shopify', volume: '27,100', topComp: 'Shopify', compCtr: '3.2%', yourRank: 'Not ranking', difficulty: 'Low', score: 91, cpc: '$5.80' }
    ],
    signals: [
      { comp: 'Amazon', logo: 'A', type: 'dark_period', severity: 'high', message: 'Amazon reduced Google Ads spend by 38% in the past 72 hours — Electronics category now underserved', detectedAgo: '2h ago', action: 'Attack Electronics Keywords Now', attackOpen: true },
      { comp: 'eBay', logo: 'e', type: 'new_campaign', severity: 'medium', message: 'eBay launched 4 new Meta carousel ads targeting "collectibles & vintage" audiences — new creative approach', detectedAgo: '6h ago', action: 'Counter with Vintage Positioning', attackOpen: false },
      { comp: 'Shopify', logo: 'S', type: 'budget_surge', severity: 'medium', message: 'Shopify increased LinkedIn Ads spend by 52% — aggressively targeting SMB owner audiences this week', detectedAgo: '1d ago', action: 'Defend SMB Audience Segments', attackOpen: false },
      { comp: 'Etsy', logo: 'E', type: 'price_change', severity: 'low', message: 'Etsy raised seller transaction fees from 6.5% to 8% — major seller dissatisfaction emerging on social', detectedAgo: '3d ago', action: 'Target Etsy Seller Migration', attackOpen: true }
    ],
    predictions: [
      { comp: 'Amazon', logo: 'A', prediction: 'Prime Day preparation surge: Amazon historically increases Google Shopping spend by 180% in the 3 weeks before Prime Day. Based on current patterns, this surge is estimated to begin in 11 days.', confidence: 91, timeframe: '11 days', action: 'Pre-bid on Shopping keywords before CPCs spike', impact: 'High' },
      { comp: 'Shopify', logo: 'S', prediction: 'New pricing tier announcement likely within 21 days based on their 6-month pricing revision cadence. Expect a campaign pushing their "value vs. alternatives" narrative targeting your brand keywords.', confidence: 74, timeframe: '21 days', action: 'Launch preemptive price-match campaign now', impact: 'Medium' },
      { comp: 'eBay', logo: 'e', prediction: 'eBay typically runs a seasonal clearance push in Q2 with 25–40% higher ad spend. Pattern indicates launch in 6 days targeting deal-seeking audiences.', confidence: 83, timeframe: '6 days', action: 'Counter with "everyday low price" positioning', impact: 'Medium' }
    ],
    roadmap: [
      { week: 'Week 1–2', title: 'Claim the Attack Windows', desc: 'Amazon reduced electronics spend — immediately bid on their vacated keywords. Target their top 12 paused keywords with 40% higher bids. Est. CPA: -22%.', status: 'urgent' },
      { week: 'Week 3–4', title: 'Capture Etsy Seller Migration', desc: 'Etsy fee increase is driving seller dissatisfaction. Launch a direct migration campaign targeting "Etsy alternative for sellers" keywords. Estimated 15,000 new seller leads/month.', status: 'high' },
      { week: 'Week 5–8', title: 'Own the Mid-Market Keyword Gap', desc: 'Run aggressive campaigns on the 6 high-opportunity keywords identified in the Keyword Gap table. Combined monthly volume: 384,200. Your current ranking: 0.', status: 'medium' },
      { week: 'Week 9–12', title: 'Dominate Share of Voice in Target Segments', desc: 'With gaps captured, shift budget to brand-building campaigns. Target: 12% Share of Voice (from 5%) in the handmade, dropshipping, and electronics sub-categories.', status: 'medium' }
    ],
    winLoss: [
      { comp: 'Amazon', message: '"Free 1-day Prime delivery on millions of items"', channel: 'Google Shopping', lossRate: '34%', weakness: 'No personalisation — attack with curated selection messaging' },
      { comp: 'Etsy', message: '"Unique gifts you won\'t find anywhere else — support independent creators"', channel: 'Meta', lossRate: '28%', weakness: 'High fees now eroding trust — attack with seller profit messaging' },
      { comp: 'Shopify', message: '"Your business. Your brand. Start free."', channel: 'Google', lossRate: '21%', weakness: 'Generic — attack with specific feature comparison ads' }
    ]
  },

  fintech: {
    categoryScore: 24,
    shareOfVoice: [
      { name: 'Revolut', share: 22, trend: '+5%', color: '#0D1B2A' },
      { name: 'Wise', share: 18, trend: '+3%', color: '#9FE870' },
      { name: 'Stripe', share: 16, trend: '+2%', color: '#635BFF' },
      { name: 'PayPal', share: 24, trend: '-3%', color: '#003087' },
      { name: 'You', share: 4, trend: '+0%', color: '#00C9C8' },
      { name: 'Others', share: 16, trend: '', color: '#E5E7EB' }
    ],
    keywordGaps: [
      { keyword: 'international money transfer fee', volume: '90,500', topComp: 'Wise', compCtr: '4.8%', yourRank: 'Not ranking', difficulty: 'Medium', score: 95, cpc: '$6.20' },
      { keyword: 'best crypto debit card', volume: '40,500', topComp: 'Revolut', compCtr: '5.2%', yourRank: 'Not ranking', difficulty: 'Medium', score: 91, cpc: '$4.80' },
      { keyword: 'paypal alternative lower fees', volume: '33,100', topComp: 'Stripe', compCtr: '3.9%', yourRank: 'Not ranking', difficulty: 'Low', score: 94, cpc: '$7.50' },
      { keyword: 'freelancer payment solution', volume: '22,200', topComp: 'Wise', compCtr: '4.1%', yourRank: 'Page 2', difficulty: 'Low', score: 89, cpc: '$5.20' },
      { keyword: 'multi currency business account', volume: '18,100', topComp: 'Revolut', compCtr: '3.7%', yourRank: 'Not ranking', difficulty: 'Medium', score: 87, cpc: '$8.90' }
    ],
    signals: [
      { comp: 'PayPal', logo: 'P', type: 'dark_period', severity: 'high', message: 'PayPal reduced all Google Ads spend by 44% following Q1 earnings revision — major keyword vacuum in payments space', detectedAgo: '4h ago', action: 'Claim PayPal Keyword Vacuum Now', attackOpen: true },
      { comp: 'Revolut', logo: 'R', type: 'new_campaign', severity: 'medium', message: 'Revolut launched new "Ultra" tier campaign targeting premium banking audiences across 12 EU markets', detectedAgo: '8h ago', action: 'Counter with Transparent Fee Comparison', attackOpen: false },
      { comp: 'Wise', logo: 'W', type: 'budget_surge', severity: 'medium', message: 'Wise increased TikTok spend by 65% targeting Gen-Z freelancers with "real exchange rate" messaging', detectedAgo: '2d ago', action: 'Compete on TikTok with Fee-Free Positioning', attackOpen: false }
    ],
    predictions: [
      { comp: 'PayPal', logo: 'P', prediction: 'PayPal historically launches aggressive back-to-school merchant campaigns in late Q2. Based on current spend patterns and Q1 reduction, expect a 200% spend increase within 18 days targeting SMB payment keywords.', confidence: 88, timeframe: '18 days', action: 'Pre-capture SMB payment keywords now at low CPC', impact: 'High' },
      { comp: 'Revolut', logo: 'R', prediction: 'Revolut new market expansion pattern suggests a major US market push within 30 days. Their last 3 expansions were preceded by LinkedIn campaign surges. LinkedIn spend has increased 38% this week.', confidence: 72, timeframe: '30 days', action: 'Strengthen US brand presence before Revolut arrives', impact: 'High' }
    ],
    roadmap: [
      { week: 'Week 1–2', title: 'Capture PayPal Keyword Vacuum', desc: 'PayPal paused $44M/mo in Google Ads — immediately attack their top 15 payment keywords. These CPCs will spike when they return. Window: 2–3 weeks.', status: 'urgent' },
      { week: 'Week 3–4', title: 'Launch Fee Comparison Campaign', desc: 'Target "PayPal alternative" and "lower fee payment" keywords with transparent fee comparison landing pages. Est. 3,200 qualified leads/week.', status: 'high' },
      { week: 'Week 5–8', title: 'Own the Freelancer Segment', desc: 'Wise owns freelancer payment keywords. Attack "freelancer payment solution" and related terms with case study ads. Combined volume: 45,000/mo.', status: 'medium' },
      { week: 'Week 9–12', title: 'Reach 12% Share of Voice', desc: 'With keyword gaps closed, run brand awareness campaigns to grow Share of Voice from 4% to 12% in the SMB payment category.', status: 'medium' }
    ],
    winLoss: [
      { comp: 'Wise', message: '"The real exchange rate. No hidden fees. Ever."', channel: 'Google', lossRate: '41%', weakness: 'Limited business features — attack with full business banking positioning' },
      { comp: 'Revolut', message: '"One app. All your money. Anywhere in the world."', channel: 'Meta', lossRate: '35%', weakness: 'Customer support issues — attack with dedicated support messaging' },
      { comp: 'PayPal', message: '"Pay, send money, and shop with confidence."', channel: 'Google', lossRate: '29%', weakness: 'High fees — attack with fee transparency comparison ads' }
    ]
  },

  saas: {
    categoryScore: 28,
    shareOfVoice: [
      { name: 'HubSpot', share: 26, trend: '+3%', color: '#FF7A59' },
      { name: 'Salesforce', share: 22, trend: '-1%', color: '#00A1E0' },
      { name: 'Zendesk', share: 14, trend: '+1%', color: '#03363D' },
      { name: 'Intercom', share: 10, trend: '+2%', color: '#1F8EED' },
      { name: 'You', share: 4, trend: '+0%', color: '#00C9C8' },
      { name: 'Others', share: 24, trend: '', color: '#E5E7EB' }
    ],
    keywordGaps: [
      { keyword: 'salesforce alternative small business', volume: '27,100', topComp: 'HubSpot', compCtr: '4.9%', yourRank: 'Not ranking', difficulty: 'Low', score: 96, cpc: '$12.40' },
      { keyword: 'crm with email marketing', volume: '33,100', topComp: 'HubSpot', compCtr: '4.2%', yourRank: 'Not ranking', difficulty: 'Medium', score: 91, cpc: '$8.80' },
      { keyword: 'zendesk competitor comparison', volume: '9,900', topComp: 'Intercom', compCtr: '5.8%', yourRank: 'Not ranking', difficulty: 'Low', score: 95, cpc: '$15.20' },
      { keyword: 'b2b saas onboarding software', volume: '14,800', topComp: 'HubSpot', compCtr: '3.6%', yourRank: 'Page 2', difficulty: 'Medium', score: 88, cpc: '$11.60' },
      { keyword: 'customer success platform', volume: '18,100', topComp: 'Salesforce', compCtr: '3.1%', yourRank: 'Not ranking', difficulty: 'High', score: 82, cpc: '$14.80' }
    ],
    signals: [
      { comp: 'HubSpot', logo: 'H', type: 'dark_period', severity: 'high', message: 'HubSpot paused all TikTok campaigns following brand safety review — TikTok B2B audience now uncontested', detectedAgo: '3h ago', action: 'Own TikTok B2B SaaS Category Now', attackOpen: true },
      { comp: 'Salesforce', logo: 'S', type: 'price_change', severity: 'high', message: 'Salesforce increased Enterprise pricing by 18% — major enterprise customer dissatisfaction on LinkedIn and G2', detectedAgo: '1d ago', action: 'Target Salesforce Price-Shocked Customers', attackOpen: true },
      { comp: 'Zendesk', logo: 'Z', type: 'new_campaign', severity: 'medium', message: 'Zendesk launched "AI Customer Service" campaign on Google targeting CX leadership keywords — new territory for them', detectedAgo: '4d ago', action: 'Counter with Superior AI CX Positioning', attackOpen: false }
    ],
    predictions: [
      { comp: 'HubSpot', logo: 'H', prediction: 'HubSpot launches their annual INBOUND marketing push in September with a 250% ad spend increase. Based on pre-event patterns (previous 3 years), brand keyword bidding begins 6 weeks prior — in approximately 14 days.', confidence: 89, timeframe: '14 days', action: 'Pre-bid on HubSpot alternative keywords now', impact: 'High' },
      { comp: 'Salesforce', logo: 'S', prediction: 'Salesforce pricing controversy will drive 12–18% increase in "Salesforce alternative" searches over the next 30 days based on sentiment analysis and review velocity on G2 and Trustpilot.', confidence: 82, timeframe: '30 days', action: 'Launch "Salesforce Alternative" landing page immediately', impact: 'High' }
    ],
    roadmap: [
      { week: 'Week 1–2', title: 'Capitalise on Salesforce Pricing Backlash', desc: 'Salesforce raised enterprise prices 18% — thousands of customers are actively evaluating alternatives. Launch "Salesforce vs. [Your Brand]" comparison campaigns now. Window is 30–45 days before they stabilise.', status: 'urgent' },
      { week: 'Week 3–4', title: 'Own the TikTok B2B Vacuum', desc: 'HubSpot paused TikTok — run thought leadership and product demo content on TikTok for B2B buyers aged 25–38. No major competitor currently active.', status: 'high' },
      { week: 'Week 5–8', title: 'Capture Alternative-Seekers', desc: 'Run campaigns on "Salesforce alternative", "HubSpot alternative", and "Zendesk competitor" keywords. Combined: 47,000 monthly searches at $12–15 CPC.', status: 'medium' },
      { week: 'Week 9–12', title: 'Grow Share of Voice to 15%', desc: 'From current 4%, a focused 12-week push targeting the keyword gaps above will grow Share of Voice to an estimated 15% in the B2B SaaS category.', status: 'medium' }
    ],
    winLoss: [
      { comp: 'HubSpot', message: '"Everything you need to grow — CRM, marketing, sales, service in one platform."', channel: 'Google', lossRate: '38%', weakness: 'Expensive at scale — attack with SMB-friendly pricing message' },
      { comp: 'Salesforce', message: '"The world\'s #1 CRM. Grow your business with the platform built for scale."', channel: 'LinkedIn', lossRate: '32%', weakness: 'Complexity and cost — attack with ease-of-use and pricing' },
      { comp: 'Zendesk', message: '"Beautiful customer service. For teams of any size."', channel: 'Google', lossRate: '24%', weakness: 'Limited proactive support features — attack with AI-first positioning' }
    ]
  },

  crypto: {
    categoryScore: 19,
    shareOfVoice: [
      { name: 'Coinbase', share: 28, trend: '+1%', color: '#1652F0' },
      { name: 'Binance', share: 32, trend: '-2%', color: '#F0B90B' },
      { name: 'Kraken', share: 12, trend: '+1%', color: '#5741D9' },
      { name: 'Bybit', share: 10, trend: '+3%', color: '#F7A600' },
      { name: 'You', share: 3, trend: '+0%', color: '#00C9C8' },
      { name: 'Others', share: 15, trend: '', color: '#E5E7EB' }
    ],
    keywordGaps: [
      { keyword: 'how to buy bitcoin safely', volume: '135,000', topComp: 'Coinbase', compCtr: '6.1%', yourRank: 'Not ranking', difficulty: 'High', score: 87, cpc: '$3.80' },
      { keyword: 'best crypto exchange low fees', volume: '74,000', topComp: 'Binance', compCtr: '5.4%', yourRank: 'Not ranking', difficulty: 'Medium', score: 92, cpc: '$4.20' },
      { keyword: 'crypto staking rewards comparison', volume: '27,100', topComp: 'Kraken', compCtr: '4.2%', yourRank: 'Page 3', difficulty: 'Low', score: 94, cpc: '$2.90' },
      { keyword: 'coinbase alternative UK', volume: '22,200', topComp: 'Kraken', compCtr: '3.8%', yourRank: 'Not ranking', difficulty: 'Low', score: 96, cpc: '$5.10' },
      { keyword: 'defi yield farming explained', volume: '33,100', topComp: 'Binance', compCtr: '3.1%', yourRank: 'Not ranking', difficulty: 'Medium', score: 85, cpc: '$1.80' }
    ],
    signals: [
      { comp: 'Binance', logo: 'B', type: 'dark_period', severity: 'high', message: 'Binance pulled all UK and EU advertising following regulatory action — massive regional keyword vacuum now open', detectedAgo: '1h ago', action: 'Claim EU/UK Crypto Keywords Immediately', attackOpen: true },
      { comp: 'Coinbase', logo: 'C', type: 'budget_surge', severity: 'medium', message: 'Coinbase doubled Google Ads budget targeting Bitcoin Bull Run keywords following BTC price surge above $70K', detectedAgo: '5h ago', action: 'Bid on Long-Tail Bitcoin Intent Keywords', attackOpen: false },
      { comp: 'Kraken', logo: 'K', type: 'new_campaign', severity: 'low', message: 'Kraken launched educational content campaign "Crypto 101" targeting first-time investor audiences on YouTube', detectedAgo: '2d ago', action: 'Counter with Superior Education Content', attackOpen: false }
    ],
    predictions: [
      { comp: 'Binance', logo: 'B', prediction: 'Binance regulatory pressure is increasing across 4 more EU jurisdictions. Historical pattern shows complete advertising withdrawal precedes regulatory action by 10–15 days. Probability of full EU withdrawal within 2 weeks is high.', confidence: 78, timeframe: '14 days', action: 'Immediately claim EU regulatory-safe positioning', impact: 'High' },
      { comp: 'Coinbase', logo: 'C', prediction: 'Coinbase launches "Retail Investor" campaign every time BTC crosses a psychological price threshold. At $75K, they historically surge spend by 300%. Based on current price trajectory, this trigger is 8 days away.', confidence: 85, timeframe: '8 days', action: 'Pre-capture retail Bitcoin keywords now at low CPC', impact: 'High' }
    ],
    roadmap: [
      { week: 'Week 1–2', title: 'Claim Binance EU Keyword Vacuum', desc: 'Binance is withdrawing from EU advertising — immediately bid on their top EU keywords at 60–70% lower CPCs than they were previously paying. Window: 3–4 weeks before other competitors respond.', status: 'urgent' },
      { week: 'Week 3–4', title: 'Launch Compliance & Safety Campaign', desc: 'Position as the compliant, regulated alternative. Target "safe crypto exchange" and "regulated crypto" keywords across Google and LinkedIn. Est. CPA: 35% lower than Binance segments.', status: 'high' },
      { week: 'Week 5–8', title: 'Own the Staking/Yield Niche', desc: 'Kraken owns staking keywords but underinvests in paid. Run staking comparison campaigns — combined monthly volume: 45,000 highly intent searches.', status: 'medium' },
      { week: 'Week 9–12', title: 'Grow to 10% Share of Voice in EU', desc: 'From 3% to 10% Share of Voice target in regulated EU crypto market as Binance withdraws and regulatory clarity improves. Focus: UK, Germany, France, Netherlands.', status: 'medium' }
    ],
    winLoss: [
      { comp: 'Coinbase', message: '"The easiest place to buy and sell cryptocurrency."', channel: 'Google', lossRate: '44%', weakness: 'High fees for retail — attack with transparent fee comparison' },
      { comp: 'Binance', message: '"The world\'s largest crypto exchange by trading volume."', channel: 'Meta', lossRate: '36%', weakness: 'Regulatory issues now a liability — attack with "trusted & regulated" messaging' },
      { comp: 'Kraken', message: '"Our mission: Bitcoin & crypto for everyone."', channel: 'YouTube', lossRate: '28%', weakness: 'Limited fiat on-ramp options — attack with seamless bank integration' }
    ]
  },

  travel: {
    categoryScore: 22,
    shareOfVoice: [
      { name: 'Booking.com', share: 31, trend: '+2%', color: '#003580' },
      { name: 'Airbnb', share: 22, trend: '+4%', color: '#FF5A5F' },
      { name: 'Expedia', share: 19, trend: '-2%', color: '#00355F' },
      { name: 'TripAdvisor', share: 14, trend: '-1%', color: '#34E0A1' },
      { name: 'You', share: 3, trend: '+0%', color: '#00C9C8' },
      { name: 'Others', share: 11, trend: '', color: '#E5E7EB' }
    ],
    keywordGaps: [
      { keyword: 'last minute hotel deals tonight', volume: '135,000', topComp: 'Booking.com', compCtr: '6.4%', yourRank: 'Not ranking', difficulty: 'High', score: 88, cpc: '$2.80' },
      { keyword: 'airbnb alternative cheaper', volume: '49,500', topComp: 'Expedia', compCtr: '4.1%', yourRank: 'Not ranking', difficulty: 'Low', score: 95, cpc: '$3.20' },
      { keyword: 'best travel insurance compare', volume: '74,000', topComp: 'Expedia', compCtr: '3.8%', yourRank: 'Not ranking', difficulty: 'Medium', score: 91, cpc: '$4.60' },
      { keyword: 'boutique hotels europe', volume: '40,500', topComp: 'Booking.com', compCtr: '3.2%', yourRank: 'Page 2', difficulty: 'Low', score: 89, cpc: '$2.10' },
      { keyword: 'eco friendly travel packages', volume: '18,100', topComp: 'TripAdvisor', compCtr: '2.9%', yourRank: 'Not ranking', difficulty: 'Low', score: 93, cpc: '$1.90' }
    ],
    signals: [
      { comp: 'Expedia', logo: 'E', type: 'dark_period', severity: 'high', message: 'Expedia cut Google Ads budget by 52% during rebranding — major hotel search keyword vacuum across all regions', detectedAgo: '6h ago', action: 'Take Expedia\'s Hotel Keywords Now', attackOpen: true },
      { comp: 'Airbnb', logo: 'A', type: 'price_change', severity: 'medium', message: 'Airbnb introduced "cleaning fee transparency" mandate — causing 28% increase in host churn complaints on social', detectedAgo: '1d ago', action: 'Target Airbnb Host Migration', attackOpen: true },
      { comp: 'Booking.com', logo: 'B', type: 'budget_surge', severity: 'medium', message: 'Booking.com increased Meta spend by 74% targeting "last minute" travel intent audiences ahead of summer', detectedAgo: '2d ago', action: 'Compete on Last-Minute with Better Pricing UX', attackOpen: false }
    ],
    predictions: [
      { comp: 'Booking.com', logo: 'B', prediction: 'Summer travel surge: Booking.com increases Google Hotel Ads spend by 220% in May–June. CPCs in hotel keywords will spike 80–120%. Based on booking volume indicators, this surge begins in 9 days.', confidence: 93, timeframe: '9 days', action: 'Lock in hotel keyword bids at current low CPCs now', impact: 'High' },
      { comp: 'Airbnb', logo: 'A', prediction: 'Airbnb host fee controversy will trigger a competitor comparison search surge. "Airbnb vs." searches have increased 34% week-over-week — this accelerates to peak in 12 days.', confidence: 81, timeframe: '12 days', action: 'Launch "Better Than Airbnb" host & guest campaigns', impact: 'Medium' }
    ],
    roadmap: [
      { week: 'Week 1–2', title: 'Capture Expedia Keyword Vacuum', desc: 'Expedia cut 52% of Google Ads — thousands of hotel and flight keywords now undercompeted. Bid aggressively at 40–60% lower CPCs for the next 3 weeks before they return.', status: 'urgent' },
      { week: 'Week 3–4', title: 'Target Airbnb Host Dissatisfaction', desc: 'Airbnb\'s cleaning fee mandate is driving host churn. Launch a direct host acquisition campaign: "List with us — no surprise fees for guests, fair revenue for hosts." Est. 8,000 new host leads.', status: 'high' },
      { week: 'Week 5–8', title: 'Own the Eco-Travel Niche', desc: 'No major travel platform owns eco-friendly travel keywords. Launch purpose-driven content + ads targeting "sustainable travel" audiences. Combined volume: 45,000/mo, minimal competition.', status: 'medium' },
      { week: 'Week 9–12', title: 'Reach 10% Share of Voice', desc: 'From 3% to 10% Share of Voice target focusing on three sub-categories: last-minute deals, boutique/independent hotels, and eco-friendly travel. All currently under-served by the majors.', status: 'medium' }
    ],
    winLoss: [
      { comp: 'Booking.com', message: '"We Price Match. Book with confidence."', channel: 'Google', lossRate: '39%', weakness: 'Generic — attack with curated independent hotel discovery' },
      { comp: 'Airbnb', message: '"Belong anywhere. Unique stays, local experiences."', channel: 'Meta', lossRate: '33%', weakness: 'Fee transparency issues — attack with honest pricing messaging' },
      { comp: 'Expedia', message: '"Save big with bundle deals — flight + hotel."', channel: 'Google', lossRate: '25%', weakness: 'Bundle complexity — attack with simplicity and transparency' }
    ]
  },

  education: {
    categoryScore: 26,
    shareOfVoice: [
      { name: 'Coursera', share: 24, trend: '+2%', color: '#0056D2' },
      { name: 'Udemy', share: 28, trend: '+1%', color: '#A435F0' },
      { name: 'Khan Academy', share: 16, trend: '-1%', color: '#14BF96' },
      { name: 'Skillshare', share: 12, trend: '+1%', color: '#00C4CC' },
      { name: 'You', share: 4, trend: '+0%', color: '#00C9C8' },
      { name: 'Others', share: 16, trend: '', color: '#E5E7EB' }
    ],
    keywordGaps: [
      { keyword: 'learn python for data science free', volume: '135,000', topComp: 'Coursera', compCtr: '5.2%', yourRank: 'Not ranking', difficulty: 'Medium', score: 91, cpc: '$2.40' },
      { keyword: 'udemy alternative cheaper', volume: '27,100', topComp: 'Skillshare', compCtr: '4.8%', yourRank: 'Not ranking', difficulty: 'Low', score: 96, cpc: '$3.10' },
      { keyword: 'ai course with certificate', volume: '49,500', topComp: 'Coursera', compCtr: '4.1%', yourRank: 'Not ranking', difficulty: 'Medium', score: 93, cpc: '$4.80' },
      { keyword: 'online coding bootcamp worth it', volume: '22,200', topComp: 'Udemy', compCtr: '3.7%', yourRank: 'Page 3', difficulty: 'Low', score: 90, cpc: '$5.20' },
      { keyword: 'corporate training platform comparison', volume: '14,800', topComp: 'Coursera', compCtr: '3.2%', yourRank: 'Not ranking', difficulty: 'Medium', score: 88, cpc: '$8.60' }
    ],
    signals: [
      { comp: 'Udemy', logo: 'U', type: 'price_change', severity: 'high', message: 'Udemy ended its legendary $9.99 sale permanently — thousands of learners searching for alternatives on Reddit and Twitter', detectedAgo: '2h ago', action: 'Target Udemy Price-Shocked Learners Now', attackOpen: true },
      { comp: 'Coursera', logo: 'C', type: 'new_campaign', severity: 'medium', message: 'Coursera launched aggressive enterprise B2B campaign targeting "employee upskilling" keywords on LinkedIn', detectedAgo: '12h ago', action: 'Counter with Flexible Team Learning Positioning', attackOpen: false },
      { comp: 'Khan Academy', logo: 'K', type: 'dark_period', severity: 'medium', message: 'Khan Academy reduced paid advertising by 61% — free education keyword searches now less contested', detectedAgo: '3d ago', action: 'Capture "free learning" Intent Searches', attackOpen: true }
    ],
    predictions: [
      { comp: 'Udemy', logo: 'U', prediction: 'Udemy permanently ended $9.99 sales, causing a 28% spike in churn searches week-over-week. Based on social sentiment velocity, "Udemy alternative" searches will peak in 7 days before the audience settles on alternatives.', confidence: 87, timeframe: '7 days', action: 'Launch "Better than Udemy" campaign immediately', impact: 'High' },
      { comp: 'Coursera', logo: 'C', prediction: 'Coursera increases spend ahead of university enrollment seasons (Aug–Sep). Based on previous 3-year pattern, their Google Ads budget increases 180% in 23 days. CPC in education will spike 60–90%.', confidence: 91, timeframe: '23 days', action: 'Capture education keywords at current low CPCs', impact: 'High' }
    ],
    roadmap: [
      { week: 'Week 1–2', title: 'Capture Udemy Price-Shocked Audience', desc: 'Udemy ended $9.99 sales — 2.4M monthly active learners are now actively looking for alternatives. Launch "Same quality. Honest pricing." campaign targeting "Udemy alternative" searches. Window: 14 days before competitors respond.', status: 'urgent' },
      { week: 'Week 3–4', title: 'Own the AI/ML Course Category', desc: 'AI certification keywords are the fastest-growing education search category (+185% YoY). Launch dedicated AI course content and campaigns. Combined monthly volume: 180,000. Competition is high but winning here defines your brand.', status: 'high' },
      { week: 'Week 5–8', title: 'Attack Khan Academy Free Keyword Gap', desc: 'Khan Academy reduced ads — attack "free learning" and "free courses" keywords to capture high-volume traffic, then convert with premium upsell. Funnel: free → certificate track.', status: 'medium' },
      { week: 'Week 9–12', title: 'Reach 14% Share of Voice', desc: 'From 4% to 14% Share of Voice target in the online learning category. Focus: AI/ML courses, professional certification, and corporate training segments.', status: 'medium' }
    ],
    winLoss: [
      { comp: 'Udemy', message: '"Learn anything. Taught by real-world experts. From $9.99."', channel: 'Google', lossRate: '42%', weakness: 'Price increase backlash — attack with transparent pricing and quality' },
      { comp: 'Coursera', message: '"Learn from top universities and companies. Get a credential."', channel: 'LinkedIn', lossRate: '35%', weakness: 'Expensive for individuals — attack with accessible certification pricing' },
      { comp: 'Skillshare', message: '"Unlock your creativity. Explore thousands of classes."', channel: 'Meta', lossRate: '22%', weakness: 'Creative niche only — attack with broader practical skills positioning' }
    ]
  },

  marketing: {
    categoryScore: 33,
    shareOfVoice: [
      { name: 'Semrush', share: 29, trend: '+3%', color: '#FF642D' },
      { name: 'Ahrefs', share: 22, trend: '+2%', color: '#1B67FF' },
      { name: 'SimilarWeb', share: 16, trend: '+1%', color: '#0099D6' },
      { name: 'Moz', share: 11, trend: '-3%', color: '#1DB68A' },
      { name: 'You', share: 6, trend: '+0%', color: '#00C9C8' },
      { name: 'Others', share: 16, trend: '', color: '#E5E7EB' }
    ],
    keywordGaps: [
      { keyword: 'semrush alternative cheaper', volume: '40,500', topComp: 'Ahrefs', compCtr: '5.8%', yourRank: 'Not ranking', difficulty: 'Low', score: 97, cpc: '$8.40' },
      { keyword: 'ai marketing intelligence platform', volume: '22,200', topComp: 'Semrush', compCtr: '3.9%', yourRank: 'Not ranking', difficulty: 'Medium', score: 99, cpc: '$11.20' },
      { keyword: 'competitor ad spy tool', volume: '18,100', topComp: 'SpyFu', compCtr: '4.2%', yourRank: 'Not ranking', difficulty: 'Low', score: 98, cpc: '$9.80' },
      { keyword: 'autonomous campaign management', volume: '8,100', topComp: 'None ranking', compCtr: '—', yourRank: 'Not ranking', difficulty: 'Low', score: 100, cpc: '$14.60' },
      { keyword: 'competitor campaign analysis tool', volume: '14,800', topComp: 'Semrush', compCtr: '3.6%', yourRank: 'Page 2', difficulty: 'Medium', score: 95, cpc: '$10.40' }
    ],
    signals: [
      { comp: 'Moz', logo: 'M', type: 'dark_period', severity: 'high', message: 'Moz reduced Google Ads spend by 71% following product pivot — major SEO tool keyword vacuum now open', detectedAgo: '5h ago', action: 'Claim Moz SEO Tool Keywords Now', attackOpen: true },
      { comp: 'Semrush', logo: 'S', type: 'price_change', severity: 'high', message: 'Semrush raised Pro plan from $119 to $139/mo — significant churn signal emerging on G2 and Reddit', detectedAgo: '1d ago', action: 'Target Semrush Price-Shocked Users', attackOpen: true },
      { comp: 'Ahrefs', logo: 'A', type: 'new_campaign', severity: 'medium', message: 'Ahrefs launched new "for agencies" campaign on LinkedIn targeting large marketing teams with 200+ seat pricing', detectedAgo: '3d ago', action: 'Counter on LinkedIn with AI-First Agency Positioning', attackOpen: false }
    ],
    predictions: [
      { comp: 'Semrush', logo: 'S', prediction: 'Semrush price increase to $139/mo will trigger a 35–50% spike in "Semrush alternative" searches over the next 21 days based on historical churn patterns from their 2021 pricing change (which triggered a 42% spike).', confidence: 88, timeframe: '21 days', action: 'Launch "Semrush Alternative" campaign immediately', impact: 'High' },
      { comp: 'Moz', logo: 'M', prediction: 'Moz product pivot suggests potential acquisition or major rebrand within 60 days. Their ad spend drop of 71% and recent layoffs indicate strategic uncertainty — their customer base is vulnerable.', confidence: 69, timeframe: '60 days', action: 'Begin Moz customer outreach campaign now', impact: 'High' }
    ],
    roadmap: [
      { week: 'Week 1–2', title: 'Attack Semrush Price-Shocked Users', desc: 'Semrush raised prices — launch aggressive "Semrush Alternative" campaign targeting their brand keywords and the surge in churn-driven searches. This is the most high-value attack window in 3 years.', status: 'urgent' },
      { week: 'Week 3–4', title: 'Claim "Autonomous Campaign" Category Ownership', desc: '"Autonomous campaign management" keyword has NO competitor ranking — you can own this entire category with a focused content + PPC campaign. Monthly volume: 8,100 with zero competition.', status: 'urgent' },
      { week: 'Week 5–8', title: 'Own Moz\'s Vacated Keywords', desc: 'Moz reduced ads 71% — their top SEO tool keywords are now uncontested. Capture "moz alternative", "domain authority checker", and "link analysis tool" — combined: 65,000 monthly searches.', status: 'high' },
      { week: 'Week 9–12', title: 'Reach 18% Share of Voice', desc: 'From 6% to 18% Share of Voice target in the marketing intelligence category. InfoGenie\'s autonomous AI positioning is unique — no competitor can replicate this in 12 weeks.', status: 'medium' }
    ],
    winLoss: [
      { comp: 'Semrush', message: '"Grow online visibility across all key channels with Semrush."', channel: 'Google', lossRate: '37%', weakness: 'Price increase backlash + no autonomous action — InfoGenie\'s key differentiator' },
      { comp: 'Ahrefs', message: '"The tools you need to grow search traffic, research your competitors."', channel: 'Google', lossRate: '31%', weakness: 'Intelligence only, no execution — InfoGenie autonomously launches campaigns' },
      { comp: 'SimilarWeb', message: '"Turn market insights into a competitive edge."', channel: 'LinkedIn', lossRate: '26%', weakness: 'Web-only data, no ad platform integration — InfoGenie connects to all 7 platforms' }
    ]
  }
};

// Generate realistic KPI data based on URL
function generateWebsiteKPIs(url, industryKey) {
  const hash = url.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const r = (min, max, seed = 0) => {
    const x = Math.sin(hash + seed) * 10000;
    return +(min + (Math.abs(x) % (max - min))).toFixed(2);
  };
  
  return {
    ctr: r(1.2, 3.8, 1),
    roas: r(2.1, 4.4, 2),
    cpa: r(18, 85, 3),
    trafficMo: Math.floor(r(50000, 2000000, 4)),
    adSpend: Math.floor(r(5000, 120000, 5)),
    convRate: r(1.8, 4.2, 6),
    impressions: Math.floor(r(500000, 8000000, 7))
  };
};

// Generate trend data for charts
function generateTrendData() {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const base = [120, 135, 128, 142, 156, 168, 175, 182, 195, 188, 210, 228];
  return {
    labels: months,
    datasets: base
  };
}

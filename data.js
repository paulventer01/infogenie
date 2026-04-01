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

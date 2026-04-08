const express = require('express');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 5000;

// Headers required for Replit proxy/preview to work correctly
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  // Allow embedding in iframes (needed for Replit preview pane)
  res.removeHeader('X-Frame-Options');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname), { etag: false, lastModified: false }));

// ── DataForSEO helpers ────────────────────────────────────────────────────────

function getDataForSEOAuth() {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return null;
  return 'Basic ' + Buffer.from(`${login}:${password}`).toString('base64');
}

async function callDataForSEO(endpoint, body) {
  const auth = getDataForSEOAuth();
  if (!auth) throw new Error('DataForSEO credentials not configured');

  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname: 'api.dataforseo.com',
      path: endpoint,
      method: 'POST',
      headers: {
        'Authorization': auth,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch(e) {
          reject(new Error('Invalid JSON from DataForSEO'));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('DataForSEO request timed out')); });
    req.write(data);
    req.end();
  });
}

// ── Competitor domain map (used when user doesn't specify) ───────────────────

const COMPETITOR_DOMAINS = {
  ecommerce:  ['amazon.com', 'ebay.com', 'shopify.com', 'etsy.com', 'walmart.com', 'target.com', 'asos.com', 'zalando.com'],
  fintech:    ['revolut.com', 'wise.com', 'stripe.com', 'paypal.com', 'robinhood.com', 'coinbase.com', 'robinhood.com', 'interactivebrokers.com'],
  saas:       ['salesforce.com', 'hubspot.com', 'zendesk.com', 'notion.so', 'asana.com', 'intercom.com'],
  crypto:     ['coinbase.com', 'binance.com', 'kraken.com', 'kucoin.com', 'okx.com', 'gemini.com'],
  travel:     ['booking.com', 'airbnb.com', 'expedia.com', 'tripadvisor.com', 'agoda.com', 'vrbo.com', 'klook.com'],
  education:  ['coursera.org', 'udemy.com', 'edx.org', 'khanacademy.org', 'skillshare.com', 'linkedin.com', 'pluralsight.com'],
  marketing:  ['hubspot.com', 'semrush.com', 'ahrefs.com', 'moz.com', 'sproutsocial.com', 'buffer.com']
};

const DIFFICULTY_LABEL = (d) => {
  if (d <= 30) return 'Low';
  if (d <= 60) return 'Medium';
  return 'High';
};

// ── POST /api/keyword-gap ─────────────────────────────────────────────────────
// Body: { yourDomain, industry, competitors?, location?, language?, limit? }

app.post('/api/keyword-gap', async (req, res) => {
  try {
    const {
      yourDomain,
      industry,
      competitors,
      location = 'United States',
      language = 'English',
      limit = 20
    } = req.body;

    if (!yourDomain) return res.status(400).json({ error: 'yourDomain is required' });

    const compDomains = (competitors && competitors.length > 0)
      ? competitors.slice(0, 7)
      : (COMPETITOR_DOMAINS[industry] || COMPETITOR_DOMAINS.ecommerce).slice(0, 7);

    const targets = [
      { target: yourDomain, target_type: 'site' },
      ...compDomains.map(d => ({ target: d, target_type: 'site' }))
    ];

    const taskObj = {
      targets,
      language_name: language,
      limit: parseInt(limit),
      filters: [['keyword_data.keyword_info.search_volume', '>', 500]],
      order_by: ['keyword_data.keyword_info.search_volume,desc']
    };
    if (location && location !== 'Global') taskObj.location_name = location;

    const payload = [taskObj];

    const raw = await callDataForSEO('/v3/dataforseo_labs/google/keyword_gap/live', payload);

    if (raw.status_code !== 20000) {
      return res.status(502).json({ error: `DataForSEO error: ${raw.status_message}` });
    }

    const task = raw.tasks && raw.tasks[0];
    if (!task || task.status_code !== 20000) {
      return res.status(502).json({ error: `Task error: ${task ? task.status_message : 'no task returned'}` });
    }

    const items = (task.result && task.result[0] && task.result[0].items) || [];

    const keywords = items.map(item => {
      const kd = item.keyword_data || {};
      const ki = kd.keyword_info || {};
      const kp = kd.keyword_properties || {};

      // Find which competitor ranks highest for this keyword
      const intersections = item.intersections || {};
      let topComp = '—';
      let topPos = 999;
      let compCtr = '—';
      let yourRankStr = 'Not ranking';

      for (const [domain, data] of Object.entries(intersections)) {
        if (domain === yourDomain) {
          if (data.rank_group) yourRankStr = `Position ${data.rank_group}`;
          continue;
        }
        if (data.rank_group && data.rank_group < topPos) {
          topPos = data.rank_group;
          topComp = domain.replace(/^www\./, '').split('.')[0];
          topComp = topComp.charAt(0).toUpperCase() + topComp.slice(1);
          const ctrTable = [0, 28.5, 15.7, 11.0, 8.0, 5.9, 4.4, 3.3, 2.6, 2.2, 1.9];
          const ctr = topPos <= 10 ? ctrTable[topPos] : 1.5;
          compCtr = ctr.toFixed(1) + '%';
        }
      }

      const vol = ki.search_volume || 0;
      const diff = kp.keyword_difficulty || 0;
      const cpc = ki.cpc ? `$${parseFloat(ki.cpc).toFixed(2)}` : '—';

      const score = Math.round(
        (vol / 1000 * 0.4) +
        ((100 - diff) * 0.4) +
        (parseFloat(ki.cpc || 0) * 2)
      );

      return {
        keyword: kd.keyword || '',
        volume: vol.toLocaleString(),
        topComp,
        compCtr,
        yourRank: yourRankStr,
        difficulty: DIFFICULTY_LABEL(diff),
        difficultyScore: diff,
        score: Math.min(100, Math.max(1, score)),
        cpc
      };
    }).filter(k => k.keyword);

    res.json({ keywords, domain: yourDomain, competitors: compDomains, timestamp: new Date().toISOString() });

  } catch(err) {
    console.error('/api/keyword-gap error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/domain-overview ─────────────────────────────────────────────────
// Body: { domains: ['domain1.com', 'domain2.com'], location?, language? }

app.post('/api/domain-overview', async (req, res) => {
  try {
    const { domains, location = 'United States', language = 'English' } = req.body;
    if (!domains || !domains.length) return res.status(400).json({ error: 'domains array is required' });

    const payload = domains.map(d => ({
      target: d,
      location_name: location,
      language_name: language
    }));

    const raw = await callDataForSEO('/v3/dataforseo_labs/google/domain_rank_overview/live', payload);

    if (raw.status_code !== 20000) {
      return res.status(502).json({ error: `DataForSEO error: ${raw.status_message}` });
    }

    const results = (raw.tasks || []).map((task, i) => {
      const r = task.result && task.result[0];
      return {
        domain: domains[i],
        organicTraffic: r ? (r.organic_etv || 0) : 0,
        organicKeywords: r ? (r.organic_count || 0) : 0,
        domainRank: r ? (r.rank || 0) : 0
      };
    });

    res.json({ results });
  } catch(err) {
    console.error('/api/domain-overview error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/sov ─────────────────────────────────────────────────────────────
// Estimate share of voice by comparing organic traffic across domains

app.post('/api/sov', async (req, res) => {
  try {
    const { yourDomain, industry, location = 'United States', language = 'English' } = req.body;
    if (!yourDomain) return res.status(400).json({ error: 'yourDomain is required' });

    const compDomains = (COMPETITOR_DOMAINS[industry] || COMPETITOR_DOMAINS.ecommerce).slice(0, 7);
    const allDomains = [yourDomain, ...compDomains];

    const payload = allDomains.map(d => ({
      target: d,
      location_name: location,
      language_name: language
    }));

    const raw = await callDataForSEO('/v3/dataforseo_labs/google/domain_rank_overview/live', payload);
    if (raw.status_code !== 20000) {
      return res.status(502).json({ error: `DataForSEO error: ${raw.status_message}` });
    }

    const entries = (raw.tasks || []).map((task, i) => {
      const r = task.result && task.result[0];
      return {
        domain: allDomains[i],
        etv: r ? (r.organic_etv || 0) : 0
      };
    });

    const totalEtv = entries.reduce((sum, e) => sum + e.etv, 0) || 1;
    const sov = entries.map((e, i) => ({
      name: i === 0 ? 'You' : e.domain.replace(/^www\./, '').split('.')[0].replace(/^\w/, c => c.toUpperCase()),
      domain: e.domain,
      share: Math.round((e.etv / totalEtv) * 100),
      etv: e.etv
    }));

    res.json({ sov, totalEtv });
  } catch(err) {
    console.error('/api/sov error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/status ───────────────────────────────────────────────────────────

app.get('/api/status', (req, res) => {
  const hasCredentials = !!(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);
  res.json({
    ok: true,
    dataforseo: hasCredentials,
    timestamp: new Date().toISOString()
  });
});

// ── Catch-all → SPA ──────────────────────────────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const startMsg = () => {
  console.log(`DataForSEO: ${process.env.DATAFORSEO_LOGIN ? 'CONFIGURED ✓' : 'NOT CONFIGURED — add DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD secrets'}`);
};

// Port 5000 — Replit preview pane (webview)
app.listen(5000, '0.0.0.0', () => {
  console.log('InfoGenie listening on port 5000 (preview pane)');
  startMsg();
});

// Port 80 — external URL (*.spock.replit.dev / new tab)
app.listen(80, '0.0.0.0', () => {
  console.log('InfoGenie listening on port 80 (external URL)');
}).on('error', (err) => {
  // Port 80 may be unavailable in some environments; non-fatal
  console.warn(`Port 80 unavailable (${err.code}) — external URL will use port 5000`);
});

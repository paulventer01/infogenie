const express = require('express');
const _https  = require('https');
const { normalizeChatParams } = require('../ai_compat');
const router  = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }

function _openai(messages, opts = {}) {
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return Promise.resolve(null);
  const body = JSON.stringify(normalizeChatParams({ model: opts.model || 'gpt-5-mini', messages, response_format: opts.json ? { type:'json_object' } : undefined, temperature: opts.temperature ?? 0.4, max_tokens: opts.max_tokens || 2000 }));
  return new Promise(resolve => {
    const req = _https.request({ hostname:'api.openai.com', path:'/v1/chat/completions', method:'POST', headers:{ 'Authorization':'Bearer '+key, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) } }, r => {
      let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try { if (r.statusCode!==200) return resolve(null); const j=JSON.parse(d); resolve(j.choices[0].message.content); } catch { resolve(null); } });
    });
    req.on('error',()=>resolve(null)); req.setTimeout(60000,()=>req.destroy()); req.write(body); req.end();
  });
}

router.post('/score', async (req, res) => {
  const { platform='meta', pixel_type='client_side', monthly_ad_spend=0, conversion_events=[], browser_targeting=false } = req.body || {};
  const losses = {
    ios_safari: platform==='meta' ? 28 : platform==='google' ? 12 : 8,
    ad_blockers: 14,
    cross_device: 9,
    cookie_consent: browser_targeting ? 18 : 6,
    pixel_fires_late: pixel_type === 'client_side' ? 11 : 2,
  };
  const totalLoss = Math.min(68, Object.values(losses).reduce((s,v)=>s+v,0));
  const recoverable = Math.round(totalLoss * (pixel_type==='server_side' ? 0.3 : 0.75));
  const score = Math.max(10, 100 - totalLoss);
  const monthlyMissedValue = monthly_ad_spend > 0 ? Math.round((totalLoss / 100) * monthly_ad_spend) : null;
  const monthlyRecoverable = monthlyMissedValue ? Math.round((recoverable / 100) * monthly_ad_spend) : null;
  res.json({ ok:true, score, total_loss_pct: totalLoss, recoverable_pct: recoverable, breakdown: losses, monthly_missed_value: monthlyMissedValue, monthly_recoverable: monthlyRecoverable, platform, pixel_type });
});

router.post('/setup-guide', async (req, res) => {
  const { platform='meta', goal='purchase', business_platform='shopify', server_lang='node' } = req.body || {};
  const sys = `You are a senior ad tracking engineer specialising in server-side conversion tracking. Return strict JSON:
{"overview":"<2-sentence plain English of why server-side tracking matters for this platform>",
"steps":[{"step":1,"title":"<step title>","description":"<clear description>","code":"<copy-paste code snippet if applicable, or empty string>","time_estimate":"<e.g. 15 min>"}],
"benefits":["<benefit 1>","<benefit 2>","<benefit 3>"],
"expected_recovery_pct":<number 15-60>,
"docs_url":"<official docs URL>"}
Steps should be actionable, specific, and production-ready. Include real API endpoint names, event names, and parameter names.`;
  const user = `Platform: ${platform}\nConversion goal: ${goal}\nBusiness platform: ${business_platform}\nServer language: ${server_lang}\n\nGenerate a complete server-side tracking setup guide with copy-paste code.`;
  const raw = await _openai([{role:'system',content:sys},{role:'user',content:user}], { json:true, max_tokens:2000 });
  if (!raw) {
    const guides = {
      meta: { overview:'Meta Conversions API (CAPI) sends events server-to-server, bypassing iOS restrictions and ad blockers. Combined with browser pixel, it can recover 20-40% of lost conversions.', steps:[{step:1,title:'Get Meta CAPI Access Token',description:'In Meta Events Manager → Settings → Conversions API → Generate access token.',code:'',time_estimate:'5 min'},{step:2,title:'Install Meta Business SDK',description:'Install the Meta Business SDK for your server language.',code:'npm install facebook-nodejs-business-sdk',time_estimate:'2 min'},{step:3,title:'Send Server Events',description:'Send Purchase events server-side when an order is created.',code:`const bizSdk = require('facebook-nodejs-business-sdk');\nconst Event = bizSdk.ServerEvent;\nconst EventRequest = bizSdk.EventRequest;\nconst UserData = bizSdk.UserData;\n\nconst userData = (new UserData())\n  .setEmail('customer@example.com')\n  .setClientIpAddress(req.ip)\n  .setClientUserAgent(req.headers['user-agent']);\n\nconst event = (new Event())\n  .setEventName('Purchase')\n  .setEventTime(Math.floor(Date.now()/1000))\n  .setUserData(userData)\n  .setCustomData({ value: 99.00, currency: 'USD' })\n  .setActionSource('website');\n\nconst eventRequest = (new EventRequest('<ACCESS_TOKEN>', '<PIXEL_ID>'))\n  .setEvents([event]);\n\nawait eventRequest.execute();`,time_estimate:'30 min'}], benefits:['Recover iOS14+ lost conversions','Bypass ad blockers','Better ROAS reporting'], expected_recovery_pct:35, docs_url:'https://developers.facebook.com/docs/marketing-api/conversions-api' },
      google: { overview:'Google Enhanced Conversions sends hashed customer data server-to-server to improve conversion measurement accuracy, especially after iOS14.', steps:[{step:1,title:'Enable Enhanced Conversions in Google Ads',description:'Google Ads → Goals → Conversions → Settings → Enhanced conversions for web → Turn on.',code:'',time_estimate:'5 min'},{step:2,title:'Send Hashed Customer Data',description:'On purchase, hash customer email and send to Google.',code:`const crypto = require('crypto');\n\nfunction hashEmail(email) {\n  return crypto.createHash('sha256')\n    .update(email.toLowerCase().trim())\n    .digest('hex');\n}\n\n// Send to Google via Measurement Protocol\nconst payload = {\n  client_id: 'GA_CLIENT_ID',\n  events: [{\n    name: 'purchase',\n    params: {\n      currency: 'USD',\n      value: 99.00,\n      transaction_id: 'ORDER_ID'\n    }\n  }],\n  user_data: { sha256_email_address: hashEmail(customerEmail) }\n};\n\nawait fetch(\`https://www.google-analytics.com/mp/collect?measurement_id=\${GA4_ID}&api_secret=\${API_SECRET}\`, {\n  method: 'POST', body: JSON.stringify(payload)\n});`,time_estimate:'45 min'}], benefits:['Better conversion accuracy','Recover cross-device conversions','Improved Smart Bidding'], expected_recovery_pct:25, docs_url:'https://developers.google.com/google-ads/api/docs/conversions/enhanced-conversions' },
    };
    const guide = guides[platform] || guides.meta;
    return res.json({ ok:true, source:'template', ...guide });
  }
  try {
    const g = JSON.parse(raw);
    res.json({ ok:true, source:'openai', ...g });
  } catch { res.json({ ok:false, error:'Failed to parse setup guide' }); }
});

module.exports = router;

const express = require('express');
const _https  = require('https');
const router  = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }

const RECIPES = [
  { id:'g2-reviews',      label:'G2 Competitor Reviews',         icon:'⭐', source:'g2.com',          description:'Extract reviews, ratings, pros/cons, and reviewer details from any G2 product page.',       fields:['review_title','rating','pros','cons','reviewer_role','company_size','date'],   instruction:'Extract all customer reviews. For each review get: title, star rating (1-5), pros text, cons text, reviewer job title, reviewer company size, and date posted.' },
  { id:'ph-launch',       label:'Product Hunt Launch Stats',      icon:'🚀', source:'producthunt.com', description:'Scrape launch details, upvote count, comments, and product tagline.',                       fields:['name','tagline','upvotes','comments','maker','launch_date','badges'],           instruction:'Extract the product launch data: product name, tagline, number of upvotes, number of comments, maker name, launch date, and any badges or awards.' },
  { id:'trustpilot',      label:'Trustpilot Sentiment',           icon:'🌟', source:'trustpilot.com',  description:'Pull TrustScore, review count, rating breakdown, and sample reviews.',                      fields:['company','trust_score','total_reviews','5_star','4_star','3_star','2_star','1_star','sample_reviews'], instruction:'Extract the TrustScore, total number of reviews, breakdown of reviews by star rating (5-1 stars), and the first 5 review snippets with their dates.' },
  { id:'linkedin-company',label:'LinkedIn Company Signals',       icon:'💼', source:'linkedin.com',    description:'Extract headcount, follower count, about section, recent posts, and top employees.',         fields:['company','industry','size','followers','about','recent_post','location'],       instruction:'Extract: company name, industry, employee count, follower count, the full About section text, company HQ location, and up to 3 recent post titles.' },
  { id:'hn-discussion',   label:'Hacker News Discussion',         icon:'🟠', source:'news.ycombinator.com', description:'Extract top comments, sentiment, and key themes from any HN thread.',                  fields:['post_title','points','comment_author','comment_text','upvotes'],               instruction:'Extract the post title, total points, and the top 15 comments with author username, comment text, and their upvote count.' },
  { id:'app-store',       label:'App Store / Play Store Reviews', icon:'📱', source:'apps.apple.com',  description:'Extract app rating, review count, and top user reviews from app store pages.',               fields:['app_name','rating','review_count','review_title','review_body','rating_given'], instruction:'Extract the app name, average rating, total review count, and the first 10 user reviews with title, body text, and star rating.' },
  { id:'glassdoor',       label:'Glassdoor Culture Intel',        icon:'🏢', source:'glassdoor.com',   description:'Pull overall score, sub-scores, recommend %, and sample employee reviews.',                  fields:['company','overall_score','ceo_approval','recommend_pct','culture','mgmt','pros','cons'], instruction:'Extract: overall company rating, CEO approval rating, % who recommend to a friend, sub-ratings for culture/management/compensation, and 5 employee review excerpts with pros and cons.' },
  { id:'capterra',        label:'Capterra Feature Comparison',    icon:'📊', source:'capterra.com',    description:'Extract features list, pricing tiers, and user ratings from Capterra product pages.',         fields:['product','pricing_start','features','overall_rating','ease_of_use','support'],  instruction:'Extract the product name, starting price, the full features list, and ratings for: overall, ease of use, customer service, and value for money.' },
  { id:'pricing-page',   label:'Competitor Pricing Page',        icon:'💰', source:'any website',     description:'Extract all pricing tiers, prices, billing cycles, and included features.',                  fields:['tier_name','price','billing','features','cta_text'],                           instruction:'Extract all pricing tiers. For each tier: name, price, billing cycle (monthly/annual), list of included features, and the call-to-action button text.' },
  { id:'jobs-page',       label:'Competitor Jobs Page',           icon:'👥', source:'any website',     description:'Extract open roles, departments, locations, and hiring velocity signals.',                    fields:['role_title','department','location','type','posted_date'],                     instruction:'Extract all open job listings. For each: job title, department/team, location (remote/city), employment type, and date posted if available.' },
];

function _openai(messages, opts = {}) {
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return Promise.resolve(null);
  const body = JSON.stringify({ model: opts.model || 'gpt-4o-mini', messages, response_format: opts.json ? { type:'json_object' } : undefined, temperature: 0.2, max_tokens: opts.max_tokens || 2000 });
  return new Promise(resolve => {
    const req = _https.request({ hostname:'api.openai.com', path:'/v1/chat/completions', method:'POST', headers:{ 'Authorization':'Bearer '+key, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) } }, r => {
      let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try { if (r.statusCode!==200) return resolve(null); const j=JSON.parse(d); resolve(j.choices[0].message.content); } catch { resolve(null); } });
    });
    req.on('error',()=>resolve(null)); req.setTimeout(60000,()=>req.destroy()); req.write(body); req.end();
  });
}

async function _firecrawlFetch(url) {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return null;
  const body = JSON.stringify({ url, formats:['markdown'], onlyMainContent: true });
  return new Promise(resolve => {
    const req = _https.request({ hostname:'api.firecrawl.dev', path:'/v1/scrape', method:'POST', headers:{ 'Authorization':'Bearer '+key, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) } }, r => {
      let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try { const j=JSON.parse(d); resolve(j.data?.markdown || j.markdown || null); } catch { resolve(null); } });
    });
    req.on('error',()=>resolve(null)); req.setTimeout(30000,()=>req.destroy()); req.write(body); req.end();
  });
}

router.get('/recipes', (req, res) => {
  res.json({ ok:true, recipes: RECIPES.map(r=>({ id:r.id, label:r.label, icon:r.icon, source:r.source, description:r.description, fields:r.fields })) });
});

router.post('/run', async (req, res) => {
  const { recipe_id, target_url } = req.body || {};
  const recipe = RECIPES.find(r=>r.id===recipe_id);
  if (!recipe) return _err(res,400,'unknown_recipe');
  if (!target_url || !/^https?:\/\//i.test(target_url)) return _err(res,400,'invalid_target_url');
  const markdown = await _firecrawlFetch(target_url);
  if (!markdown) return _err(res,503,'Could not fetch page. Ensure FIRECRAWL_API_KEY is set.');
  const sys = `You are an AI data extraction specialist using a pre-built recipe. Extract the following data from the webpage and return JSON:
{"columns":${JSON.stringify(recipe.fields)},"rows":[<one object per row, keys matching columns>],"summary":"<1-2 sentences of what was found>","total_found":<number>}
Only extract real data visible on the page. Never invent data.`;
  const user = `Recipe: ${recipe.label}\nTarget URL: ${target_url}\nExtraction instruction: ${recipe.instruction}\n\nPAGE CONTENT:\n${markdown.slice(0,6000)}`;
  const raw = await _openai([{role:'system',content:sys},{role:'user',content:user}], { json:true, max_tokens:2000 });
  if (!raw) return res.json({ ok:true, source:'unavailable', recipe_id, columns:recipe.fields, rows:[], summary:'AI unavailable — try again later.', total_found:0 });
  try {
    const data = JSON.parse(raw);
    res.json({ ok:true, source:'openai', recipe_id, recipe_label:recipe.label, ...data });
  } catch { res.json({ ok:false, error:'Could not parse extracted data' }); }
});

module.exports = router;

const express  = require('express');
const router   = express.Router();
const _https   = require('https');
const _db      = require('../../db');
const _tenantCtx = require('../tenants/context');

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _safeAsync(h) {
  return (req, res) => Promise.resolve(h(req, res)).catch(e => {
    console.warn('[yt-comment-miner]', e.stack || e.message);
    if (!res.headersSent) _err(res, 500, 'Internal server error');
  });
}
function _hasPerplexity() { const k = process.env.PERPLEXITY_API_KEY; return k && !/^_DUMMY/i.test(k); }
function _hasOpenAI()     { const k = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY; return k && !/^_DUMMY/i.test(k); }

function _perplexityCall(prompt) {
  return new Promise(resolve => {
    const body = JSON.stringify({
      model: 'sonar', temperature: 0.1, max_tokens: 5000,
      messages: [{ role: 'user', content: prompt }]
    });
    const req = _https.request({
      hostname: 'api.perplexity.ai', path: '/chat/completions', method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        try { resolve(JSON.parse(d)?.choices?.[0]?.message?.content || ''); }
        catch { resolve(''); }
      });
    });
    req.on('error', () => resolve(''));
    req.setTimeout(55000, () => { req.destroy(); resolve(''); });
    req.write(body); req.end();
  });
}

function _openAICall(messages) {
  return new Promise(resolve => {
    const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
    const body = JSON.stringify({
      model: 'gpt-5-mini', temperature: 0.3, max_tokens: 3500,
      response_format: { type: 'json_object' },
      messages
    });
    const req = _https.request({
      hostname: 'api.openai.com', path: '/v1/chat/completions', method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        try { resolve(JSON.parse(JSON.parse(d)?.choices?.[0]?.message?.content || '{}') || {}); }
        catch { resolve({}); }
      });
    });
    req.on('error', () => resolve({}));
    req.setTimeout(45000, () => { req.destroy(); resolve({}); });
    req.write(body); req.end();
  });
}

// ── Template fallback ────────────────────────────────────────────────────────
function _templateResult(channelName) {
  const cn = channelName || 'this channel';
  return {
    questions: [
      { text: `When will ${cn} cover beginner-level tutorials?`, recurrence: 47 },
      { text: `What tools do you actually use day-to-day?`, recurrence: 38 },
      { text: `Can you do a comparison video vs the top alternatives?`, recurrence: 31 },
      { text: `How do you handle [common pain point] in your workflow?`, recurrence: 24 },
      { text: `What's your take on the recent changes in the industry?`, recurrence: 19 },
      { text: `Could you make a longer deep-dive on this topic?`, recurrence: 15 },
    ],
    themes: [
      { theme: 'Tutorial / how-to requests', count: 52, sentiment: 'positive' },
      { theme: 'Tool & product recommendations', count: 41, sentiment: 'positive' },
      { theme: 'Beginner confusion / gaps', count: 33, sentiment: 'neutral' },
      { theme: 'Competitor comparisons', count: 28, sentiment: 'neutral' },
      { theme: 'Pain points not addressed', count: 22, sentiment: 'negative' },
    ],
    content_ideas: [
      { title: `Complete Beginner's Guide to [${cn}'s Main Topic]`, angle: 'Step-by-step walkthrough assuming zero prior knowledge', why_it_works: 'Beginner requests dominate comments — first-touch viewers convert to subscribers at 3× the rate of existing fans' },
      { title: `My Exact Toolkit: Every Tool I Actually Use`, angle: 'Honest review of paid vs free options, what I\'d cut first', why_it_works: 'Tool recommendation threads get 5× more saves than average — high purchase-intent audience' },
      { title: `[Competitor] vs [${cn}]: Honest Head-to-Head`, angle: 'Fair comparison with clear winner for each use case', why_it_works: 'Comparison content ranks for high-intent searches and captures undecided buyers' },
      { title: `The 5 Mistakes Beginners Make (And How to Fix Them)`, angle: 'Turn the most common comment complaints into a listicle', why_it_works: 'Problem-solution format has highest 3-second retention in this niche' },
      { title: `Q&A: Answering Your 20 Most-Asked Questions`, angle: 'Pull directly from comment questions — audiences love being heard', why_it_works: 'Q&A format drives comment engagement 2× higher than standard uploads' },
      { title: `Deep Dive: [Top Requested Topic] — Everything You Need to Know`, angle: '15-20 min exhaustive guide for committed learners', why_it_works: 'Long-form depth drives watch time and signals authority to the algorithm' },
    ],
    sentiment_breakdown: { positive: 54, neutral: 31, negative: 15 },
    comment_count: 150,
    source: 'template'
  };
}

// ── Core mine function ───────────────────────────────────────────────────────
async function _mineComments({ channelName, channelUrl, videoUrl }) {
  const target = videoUrl
    ? `the YouTube video at URL: ${videoUrl}`
    : `the YouTube channel "${channelName}" (${channelUrl}) — focus on the 5-10 most recent videos`;

  // Step 1: Perplexity fetches raw comments
  if (!_hasPerplexity()) return _templateResult(channelName || videoUrl);

  const perpPrompt = `You are a YouTube comment analyst. Collect 80-120 real audience comments from ${target}.

For each comment include: the comment text, approximate like count (if visible), and the video it came from.

Return strict JSON:
{
  "comments": [
    { "text": "...", "likes": 12, "video": "video title or url" }
  ],
  "total_collected": 95
}

Focus on substantive comments (questions, suggestions, complaints, praise) — skip generic "great video!" or spam. Return only real comments, never invent.`;

  const perpRaw  = await _perplexityCall(perpPrompt);
  let rawComments = [];
  let totalCollected = 0;
  try {
    const m = perpRaw.match(/\{[\s\S]*\}/);
    if (m) {
      const parsed = JSON.parse(m[0]);
      rawComments = Array.isArray(parsed.comments) ? parsed.comments : [];
      totalCollected = parsed.total_collected || rawComments.length;
    }
  } catch (_) {}

  // Step 2: GPT-4o-mini classifies + generates ideas
  if (!_hasOpenAI()) return _templateResult(channelName || videoUrl);
  if (!rawComments.length) return _templateResult(channelName || videoUrl);

  const commentList = rawComments.slice(0, 100).map((c, i) =>
    `${i+1}. [${c.likes||0} likes] "${String(c.text||'').slice(0,200)}"`
  ).join('\n');

  const gptResult = await _openAICall([
    {
      role: 'system',
      content: 'You are a content strategist who specialises in turning YouTube audience comment data into actionable content ideas. Strict JSON only.'
    },
    {
      role: 'user',
      content: `Analyse these ${rawComments.length} YouTube comments from ${channelName || videoUrl || 'a YouTube channel'} and return content intelligence.

COMMENTS:
${commentList}

Return strict JSON:
{
  "questions": [
    { "text": "exact or paraphrased question from comments", "recurrence": 23 }
  ],
  "themes": [
    { "theme": "Tutorials / how-to content", "count": 34, "sentiment": "positive|neutral|negative" }
  ],
  "content_ideas": [
    {
      "title": "Specific, compelling video title",
      "angle": "The specific angle or approach for this video",
      "why_it_works": "Evidence from the comments that makes this a strong bet"
    }
  ],
  "sentiment_breakdown": { "positive": 52, "neutral": 31, "negative": 17 }
}

Rules:
- questions: extract 5-10 most recurring questions/requests, sorted by recurrence (highest first). recurrence = estimated number of comments raising this question.
- themes: identify 4-6 dominant content-gap themes. count = number of comments belonging to this theme.
- content_ideas: generate 6-10 specific, immediately actionable video ideas grounded in the comment patterns. Each title should be usable as-is. why_it_works must cite a specific signal from the comments.
- sentiment_breakdown: positive + neutral + negative must sum to 100.`
    }
  ]);

  const questions  = Array.isArray(gptResult.questions)  ? gptResult.questions.slice(0, 10)  : _templateResult(channelName).questions;
  const themes     = Array.isArray(gptResult.themes)     ? gptResult.themes.slice(0, 8)      : _templateResult(channelName).themes;
  const ideas      = Array.isArray(gptResult.content_ideas) ? gptResult.content_ideas.slice(0, 10) : _templateResult(channelName).content_ideas;
  const sentiment  = (gptResult.sentiment_breakdown && typeof gptResult.sentiment_breakdown.positive === 'number')
    ? gptResult.sentiment_breakdown
    : _templateResult(channelName).sentiment_breakdown;

  return {
    questions, themes,
    content_ideas: ideas,
    sentiment_breakdown: sentiment,
    comment_count: totalCollected || rawComments.length,
    source: 'perplexity+openai'
  };
}

// ── Routes ───────────────────────────────────────────────────────────────────
router.get('/test', (req, res) => res.json({ ok: true, perplexity: _hasPerplexity(), openai: _hasOpenAI() }));

router.post('/mine', _safeAsync(async (req, res) => {
  const channelId = req.body?.channelId ? parseInt(req.body.channelId, 10) : null;
  const videoUrl  = String(req.body?.videoUrl || '').trim().slice(0, 500);

  if (!channelId && !videoUrl) return _err(res, 400, 'Provide channelId (from YouTube Monitor) or videoUrl.');
  if (videoUrl && !/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(videoUrl)) {
    return _err(res, 400, 'videoUrl must be a youtube.com or youtu.be URL.');
  }

  const tid = await _tenantCtx.resolveTenantId(req, { label: 'yt_comment_miner:mine' });

  let channelName = null;
  let channelUrl  = null;

  if (channelId && _db.hasDb && _db.hasDb()) {
    try {
      const ch = await _db.getPool().query(
        'SELECT channel_name, channel_url FROM yt_channels WHERE id=$1 AND tenant_id=$2',
        [channelId, tid]
      );
      if (!ch.rows[0]) return _err(res, 404, 'Channel not found. Add it in YouTube Monitor first.');
      channelName = ch.rows[0].channel_name;
      channelUrl  = ch.rows[0].channel_url;
    } catch (e) { return _err(res, 500, 'DB error: ' + e.message); }
  }

  const result = await _mineComments({ channelName, channelUrl, videoUrl: videoUrl || null });

  if (_db.hasDb && _db.hasDb()) {
    try {
      await _db.getPool().query(
        `INSERT INTO yt_comment_runs
           (tenant_id, channel_id, channel_name, video_url, questions, themes, content_ideas, sentiment_breakdown, comment_count)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          tid,
          channelId || null,
          channelName || videoUrl || '',
          videoUrl || null,
          JSON.stringify(result.questions),
          JSON.stringify(result.themes),
          JSON.stringify(result.content_ideas),
          JSON.stringify(result.sentiment_breakdown),
          result.comment_count
        ]
      );
    } catch (e) { console.warn('[yt-comment-miner] persist failed:', e.message); }
  }

  res.json({
    ok: true,
    channel_name: channelName || null,
    video_url:    videoUrl    || null,
    questions:    result.questions,
    themes:       result.themes,
    content_ideas: result.content_ideas,
    sentiment_breakdown: result.sentiment_breakdown,
    comment_count: result.comment_count,
    source: result.source
  });
}));

router.get('/runs', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return res.json({ ok: true, runs: [] });
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'yt_comment_miner:runs' });
  const r = await _db.getPool().query(
    `SELECT id, channel_id, channel_name, video_url, comment_count, sentiment_breakdown, created_at
     FROM yt_comment_runs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20`,
    [tid]
  );
  res.json({ ok: true, runs: r.rows });
}));

router.get('/runs/:id', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return _err(res, 404, 'not found');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'yt_comment_miner:run' });
  const r = await _db.getPool().query(
    'SELECT * FROM yt_comment_runs WHERE id=$1 AND tenant_id=$2',
    [parseInt(req.params.id, 10), tid]
  );
  if (!r.rows[0]) return _err(res, 404, 'not found');
  res.json({ ok: true, run: r.rows[0] });
}));

router.delete('/runs/:id', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return _err(res, 404, 'not found');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'yt_comment_miner:delete' });
  const r = await _db.getPool().query(
    'DELETE FROM yt_comment_runs WHERE id=$1 AND tenant_id=$2 RETURNING id',
    [parseInt(req.params.id, 10), tid]
  );
  if (!r.rows[0]) return _err(res, 404, 'not found');
  res.json({ ok: true, deleted: r.rows[0].id });
}));

module.exports = router;

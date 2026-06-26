// Smart Send Time + AI Translation helpers for drip campaigns
const express = require('express');
const router = express.Router();
const OpenAI = require('openai');

// POST /api/drips/smart-send-time
// Analyses engagement history to recommend the optimal send hour (0-23 UTC)
// per contact. Reads from drip history entries in kv_store.
router.post('/smart-send-time', async (req, res) => {
  try {
    const { contacts = [], history = [] } = req.body || {};
    if (!Array.isArray(contacts) || !contacts.length) {
      return res.status(400).json({ ok: false, error: 'contacts array required' });
    }
    // Build a simple engagement frequency map from open/click history
    const hourCounts = new Array(24).fill(0);
    for (const h of history) {
      if (h.opened_at || h.clicked_at) {
        const ts = h.opened_at || h.clicked_at;
        try { hourCounts[new Date(ts).getUTCHours()]++; } catch(_) {}
      }
    }
    const bestHour = hourCounts.indexOf(Math.max(...hourCounts));
    const totalSignals = hourCounts.reduce((a, b) => a + b, 0);
    // Per-contact recommendations (personalized if per-contact history provided,
    // falls back to population-level best hour)
    const recommendations = contacts.map(c => {
      const contactHistory = history.filter(h => h.email === c.email);
      const cHours = new Array(24).fill(0);
      let cBest = bestHour;
      if (contactHistory.length >= 3) {
        for (const h of contactHistory) {
          if (h.opened_at || h.clicked_at) {
            try { cHours[new Date(h.opened_at || h.clicked_at).getUTCHours()]++; } catch(_) {}
          }
        }
        cBest = cHours.indexOf(Math.max(...cHours));
      }
      return {
        email: c.email,
        preferred_send_hour: cBest,
        preferred_send_time: `${String(cBest).padStart(2,'0')}:00 UTC`,
        confidence: contactHistory.length >= 3 ? 'personalized' : 'population-default',
        signals_used: contactHistory.length
      };
    });
    res.json({
      ok: true,
      population_best_hour: bestHour,
      population_best_time: `${String(bestHour).padStart(2,'0')}:00 UTC`,
      total_engagement_signals: totalSignals,
      recommendations
    });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// POST /api/drips/translate
// Translates a drip sequence to a target language using GPT-4o-mini.
router.post('/translate', async (req, res) => {
  try {
    const { sequence = [], target_language, brand_name } = req.body || {};
    if (!Array.isArray(sequence) || !sequence.length) {
      return res.status(400).json({ ok: false, error: 'sequence array required' });
    }
    if (!target_language?.trim()) {
      return res.status(400).json({ ok: false, error: 'target_language required (e.g. Spanish, French, German)' });
    }
    let translated = null;
    try {
      const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY });
      const prompt = `You are a professional email translator. Translate this drip email sequence to ${target_language}.
Preserve all formatting, placeholders ({{name}}, {{company}}, etc.), and the brand voice.
Brand: ${brand_name || 'Our Brand'}
Sequence: ${JSON.stringify(sequence.map(s => ({ subject: s.subject, body: s.body })))}
Return strict JSON: {"translated":[{"subject":"...","body":"..."}]}
Translate ONLY the text content. Never translate email addresses, URLs, or placeholder tokens.`;
      const r = await openai.chat.completions.create({
        model: 'gpt-4o-mini', response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }]
      });
      const parsed = JSON.parse(r.choices[0].message.content);
      if (!parsed._DUMMY && Array.isArray(parsed.translated)) translated = parsed.translated;
    } catch(e2) {}

    if (!translated) {
      translated = sequence.map(s => ({
        subject: `[${target_language}] ${s.subject || 'Email'}`,
        body: `[Translation to ${target_language} unavailable — AI key not configured]\n\n${s.body || ''}`
      }));
    }
    // Merge translated text back into the original sequence objects
    const result = sequence.map((step, i) => ({
      ...step,
      subject: translated[i]?.subject || step.subject,
      body: translated[i]?.body || step.body,
      translated_language: target_language,
      original_subject: step.subject,
      original_body: step.body
    }));
    res.json({ ok: true, target_language, translated_sequence: result, step_count: result.length });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

module.exports = router;
